import { contextBridge, ipcRenderer } from 'electron'

// Every call resolves to its value or throws the service's error message.
const call =
  (channel) =>
  async (...args) => {
    const r = await ipcRenderer.invoke(channel, ...args)
    if (!r.ok) throw Object.assign(new Error(r.error), { errors: r.errors })
    return r.value
  }
const on = (channel) => (cb) => {
  const listener = (_e, payload) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('ivstudio', {
  app: { info: call('app:info') },
  settings: { get: call('settings:get'), set: call('settings:set'), setComfyKey: call('settings:setComfyKey') },
  edits: {
    meta: call('edits:meta'),
    list: call('edits:list'),
    get: call('edits:get'),
    create: call('edits:create'),
    save: call('edits:save'),
    delete: call('edits:delete'),
    pickFiles: call('edits:pickFiles'),
    library: call('edits:library'),
    addOutput: call('edits:addOutput'),
    export: call('edits:export'),
    cancelExport: call('edits:cancelExport'),
    onProgress: on('edits:progress')
  },
  cloud: {
    status: call('cloud:status'),
    install: call('cloud:install'),
    signIn: call('cloud:signIn'),
    deploy: call('cloud:deploy'),
    fetchModels: call('cloud:fetchModels'),
    uploadCharacters: call('cloud:uploadCharacters'),
    use: call('cloud:use'),
    wake: call('cloud:wake'),
    onLog: on('cloud:log')
  },
  prompts: { status: call('prompts:status'), write: call('prompts:write'), story: call('prompts:story'), pull: call('prompts:pull'), onPull: on('prompts:pull') },
  setup: { check: call('setup:check') },
  h3Models: call('models:h3'),
  models: { status: call('models:status'), download: call('models:download'), cancel: call('models:cancel'), onUpdate: on('models:update') },
  characters: { list: call('characters:list'), save: call('characters:save') },
  projects: { list: call('projects:list'), get: call('projects:get'), rename: call('projects:rename') },
  sequences: {
    list: call('sequences:list'),
    get: call('sequences:get'),
    create: call('sequences:create'),
    save: call('sequences:save'),
    delete: call('sequences:delete'),
    take: call('sequences:take'),
    retake: call('sequences:retake'),
    renderOut: call('sequences:renderOut'),
    huntShot: call('sequences:huntShot'),
    finishShot: call('sequences:finishShot')
  },
  render: { plan: call('render:plan'), planFinish: call('render:planFinish'), previews: call('render:previews'), finish: call('render:finish') },
  jobs: { watch: call('jobs:watch'), cancel: call('jobs:cancel'), onUpdate: on('jobs:update') },
  files: { pick: call('files:pick'), reveal: call('files:reveal') },
  links: { open: call('links:open') }
})
