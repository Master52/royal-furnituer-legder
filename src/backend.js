import scriptSource from '../google-apps-script/Code.gs?raw';

export const BACKEND_SOURCE = scriptSource;
export const BUNDLED_BACKEND_VERSION = scriptSource.match(/const BACKEND_VERSION = '([^']+)'/)[1];
export function backendInfo(result) {
  return {
    version: typeof result.backendVersion === 'string' ? result.backendVersion : '',
    checkedAt: new Date().toISOString(),
  };
}
