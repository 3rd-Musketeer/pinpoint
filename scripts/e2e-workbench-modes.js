export const workbenchGroupMode = (index, override) => override || (index === 0 ? 'bundle' : 'dev');

// 文件分组不能丢掉模式专属回归：分到另一模式时，单独补跑相应标签。
export function workbenchSupplement(groups, taggedFiles, mode, override) {
  return [...new Set(groups.flatMap((files, index) => workbenchGroupMode(index, override) !== mode
    ? files.filter(file => taggedFiles.includes(file)) : []))];
}
