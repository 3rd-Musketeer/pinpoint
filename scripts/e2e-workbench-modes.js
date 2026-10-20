export const workbenchGroupMode = (index, override) => override || (index === 0 ? 'bundle' : 'dev');

// 某文件被分到 bundle 组时，其中依赖源码模块顺序的测试还需单独在 dev 跑。
export function devModuleSupplement(groups, filesWithDevModules, override) {
  return [...new Set(groups.flatMap((files, index) => workbenchGroupMode(index, override) === 'bundle'
    ? files.filter(file => filesWithDevModules.includes(file)) : []))];
}
