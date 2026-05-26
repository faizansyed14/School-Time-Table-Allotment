/** Hash-router path, e.g. appPath('/dashboard') → '/#/dashboard' */
export function appPath(path = '/') {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `/#${p}`;
}
