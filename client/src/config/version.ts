declare const __FH_GIT_HASH__: string;
declare const __FH_BUILD_TIME__: string;

export const BUILD_VERSION = import.meta.env.VITE_BUILD_VERSION || __FH_GIT_HASH__ || 'unknown';
export const BUILD_TIME = __FH_BUILD_TIME__ || 'unknown';
