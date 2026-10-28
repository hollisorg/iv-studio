"""IV Studio cloud gate: the only way in to a cloud ComfyUI.

A public cloud address would otherwise give anyone who found it a free GPU and every file on it, so
this sits in front of ComfyUI (127.0.0.1:8188) on port 8189 and lets a request through only with the
token IV Studio created: an `Authorization: Bearer <token>` header, or `?iv_token=` for the few
requests that can't carry headers. HTTP (with Range, so videos seek) and ComfyUI's websocket are both
proxied. While ComfyUI is still starting, requests get 503 so IV Studio can show "warming up".
"""
import asyncio
import hmac
import os

import aiohttp
from aiohttp import WSMsgType, web

TOKEN = os.environ["IV_TOKEN"]
UPSTREAM = "http://127.0.0.1:8188"
HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length", "content-encoding"}


def allowed(req):
    bearer = req.headers.get("Authorization", "")
    given = bearer[7:] if bearer.startswith("Bearer ") else req.query.get("iv_token", "")
    return hmac.compare_digest(given.encode(), TOKEN.encode())


def upstream_url(req):
    query = [(k, v) for k, v in req.query.items() if k != "iv_token"]
    return UPSTREAM + req.path, query


async def proxy_ws(req, session):
    url, query = upstream_url(req)
    client = web.WebSocketResponse(max_msg_size=0)
    await client.prepare(req)
    async with session.ws_connect(url.replace("http", "ws", 1), params=query, max_msg_size=0) as upstream:

        async def pump(src, dst):
            async for msg in src:
                if msg.type == WSMsgType.TEXT:
                    await dst.send_str(msg.data)
                elif msg.type == WSMsgType.BINARY:
                    await dst.send_bytes(msg.data)
                else:
                    break

        await asyncio.wait([asyncio.create_task(pump(client, upstream)), asyncio.create_task(pump(upstream, client))], return_when=asyncio.FIRST_COMPLETED)
    return client


async def handle(req):
    if req.path == "/iv/health":  # says only that the gate is up; no data, no token needed
        return web.json_response({"gate": "ok"})
    if not allowed(req):
        return web.Response(status=401, text="IV Studio token required")
    session = req.app["session"]
    try:
        if req.headers.get("Upgrade", "").lower() == "websocket":
            return await proxy_ws(req, session)
        url, query = upstream_url(req)
        headers = {k: v for k, v in req.headers.items() if k.lower() not in HOP | {"authorization", "origin", "referer", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"}}
        body = await req.read() if req.can_read_body else None
        async with session.request(req.method, url, params=query, headers=headers, data=body, allow_redirects=False) as up:
            resp = web.StreamResponse(status=up.status, headers={k: v for k, v in up.headers.items() if k.lower() not in HOP})
            await resp.prepare(req)
            async for chunk in up.content.iter_chunked(1 << 16):
                await resp.write(chunk)
            await resp.write_eof()
            return resp
    except aiohttp.ClientConnectorError:
        return web.Response(status=503, text="ComfyUI is starting")


async def start_session(app):
    app["session"] = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None, sock_connect=5), auto_decompress=False)


async def close_session(app):
    await app["session"].close()


def main():
    app = web.Application(client_max_size=4 * 1024**3)
    app.router.add_route("*", "/{tail:.*}", handle)
    app.on_startup.append(start_session)
    app.on_cleanup.append(close_session)
    web.run_app(app, host="0.0.0.0", port=8189, access_log=None)


if __name__ == "__main__":
    main()
