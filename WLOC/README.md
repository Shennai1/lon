# WLOC Remote（Surge iOS）

这是自托管的 Apple WLOC Surge 模块。模块和两个脚本都来自本仓库，不再依赖原作者仓库或其他 Fork。

## 安装

在 Surge iOS 的“模块”页面选择“从 URL 安装”，使用：

```text
https://raw.githubusercontent.com/Shennai1/lon/main/WLOC/wloc.sgmodule
```

启用模块后，开启 MITM/HTTPS 解密，并确认 Surge CA 已安装且被系统完全信任。不要同时启用旧的 WLOC 模块，以免同一个请求被重复处理。

## 设置坐标

可以直接编辑模块参数 `longitude`、`latitude`、`accuracy` 与 `random_radius`。

也可以在 Safari 中打开以下地址，由模块内的 `wloc-settings.js` 写入 Surge 持久化存储：

```text
保存：http://wloc.invalid/wloc-settings/save?action=save&lon=121.5654&lat=25.0330&acc=25&randomRadius=0
查询：http://wloc.invalid/wloc-settings/save?action=query
清除：http://wloc.invalid/wloc-settings/save?action=clear
```

已经保存的坐标优先于模块参数。清除后，如果模块参数仍是默认经纬度，脚本会透传真实定位。

## 文件

- `wloc.sgmodule`：远程安装入口
- `wloc.js`：WLOC 二进制响应修改脚本
- `wloc-settings.js`：坐标保存、查询与清除脚本
- `LICENSE`：原项目 AGPL-3.0 许可证

## 隐私说明

Surge 使用普通 HTTPS 请求下载模块与脚本，不能自动继承 GitHub 账号登录状态。若仓库改为私有，现有安装可能因缓存暂时可用，但重新安装、更新或清除缓存后会加载失败。请保持这些运行文件可匿名访问；不要把 GitHub Token 写进模块 URL。

## 来源

核心代码源自 Yu9191/wloc 的直系 Fork 历史，并保留 AGPL-3.0 许可证。当前脚本已经过 Surge 兼容整理。
