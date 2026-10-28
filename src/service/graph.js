// Builds the exact ComfyUI API graph for one IV Studio job from the tested template, with no browser.
//
// The template (resources/workflows/iv_studio_api.json) holds every node of the IV Studio workflow. The
// group map says which nodes each switchable group owns. Turning a group off removes its nodes, the way the
// workflow's mute switches do, and drops any link that pointed at them. Bypass groups (RefMods) instead
// re-route their consumers to the node's pass-through input. This mirrors make_iv_v3_tests.py, which was
// checked against the GUI's own export for all 32 switch states.

const isLink = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string'

export function buildPrompt(template, meta, on, values = {}) {
  const g = structuredClone(template)
  const enabled = new Set(on)

  for (const [group, passthrough] of Object.entries(meta.bypass_groups || {})) {
    if (enabled.has(group)) continue
    for (const [nid, input] of Object.entries(passthrough)) {
      const source = g[nid].inputs[input]
      for (const node of Object.values(g)) {
        for (const [name, v] of Object.entries(node.inputs)) {
          if (isLink(v) && v[0] === nid && v[1] === 0) node.inputs[name] = source
        }
      }
    }
  }

  for (const [group, ids] of Object.entries(meta.groups)) {
    if (enabled.has(group)) continue
    for (const id of ids) delete g[id]
  }
  for (const node of Object.values(g)) {
    for (const [name, v] of Object.entries(node.inputs)) {
      if (isLink(v) && !(v[0] in g)) delete node.inputs[name]
    }
  }

  for (const [key, value] of Object.entries(values)) {
    const [nid, field] = key.split('.', 2).length === 2 ? [key.slice(0, key.indexOf('.')), key.slice(key.indexOf('.') + 1)] : [key, 'value']
    if (nid in g) g[nid].inputs[field] = value
  }
  return g
}

// Dangling links or groups that do not exist mean the template and the code disagree; fail loudly.
export function checkPrompt(g) {
  const problems = []
  for (const [id, node] of Object.entries(g)) {
    for (const [name, v] of Object.entries(node.inputs)) {
      if (isLink(v) && !(v[0] in g)) problems.push(`${id}.${name} -> missing ${v[0]}`)
    }
  }
  return problems
}
