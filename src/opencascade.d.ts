declare module 'opencascade.js' {
  const initOpenCascade: () => Promise<import('./engine/occTypes').OpenCascadeInstance>
  export default initOpenCascade
  export { initOpenCascade }
}
