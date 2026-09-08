# 清理旧 board 说明

frame 与 section 说明均已退役。加载器忽略 `sections[].note` 和 `sections[].screens[].note`，两类旧 note 接口均返回 410。

迁移只删除 section 和 screen 对象上的 `note`，保留页面结构、ID、HTML、文档页面和标注账本。服务启动不执行迁移，已有页面不必先清理才能打开。

先显式列出要处理的 board 文件，预览字段数量：

```sh
node scripts/remove-board-notes.mjs path/to/board.json
```

正式切换时带备份目录执行：

```sh
node scripts/remove-board-notes.mjs --backup-dir /path/to/backups path/to/board.json
```

每个输出记录包含原文件、删除数量和备份路径。备份保留原文件的完整字节；备份成功后才原子替换源文件。重复执行不会继续修改已清理的文件。批量处理逐文件完成，遇到错误停止，已完成项可从输出核对。

迁移前应结束该页面的编辑，避免与写回同时发生。需要回滚时，先核对迁移后是否还有其他修改；没有后续改动可恢复对应备份，有后续改动则只从备份补回 note 字段，避免覆盖新内容。
