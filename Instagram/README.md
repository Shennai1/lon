# Instagram 网页去广告：Surge 验证版

当前版本为 **v1.3.6 混合 50/50 测试版**。v1.3.5 的约 80% 直接折叠在实机连续滚动中仍会产生主页空白，因此本版把直接折叠比例降至约 50%：

- GraphQL / Feed JSON 只检测广告标记并写入诊断信息，不删除、不替换任何响应正文；
- 不再拒绝 `api/v1/injected_story_units/`；
- 只处理包含 Meta 精确广告跳转链接的最近一层 `article`；
- 通过广告跳转链接的稳定散列，约 1/2 广告直接折叠，约 1/2 保留原高度并显示遮罩；
- 折叠和遮罩 CSS 都要求文章**当前仍然**包含精确广告链接；节点被复用为普通帖子后，规则会自动失效；
- 页面脚本只切换一个遮罩分类，不写永久 DOM 属性或内联样式，并在节点复用后主动移除该分类；
- 不按“赞助”“Sponsored”等文字匹配，也不删除页面节点。

## 文件

- `instagram_web_ad_filter.sgmodule`：当前模块。
- `ig_ad_filter.js`：响应观察与页面注入脚本。
- `instagram_web_ad_filter.v1.3.5.sgmodule`：v1.3.5 的 80/20 实验备份。
- `instagram_web_ad_filter.v1.3.4.sgmodule`：v1.3.4 稳定回退模块。
- `instagram_web_ad_filter.v1.3.3.sgmodule`：v1.3.3 回退模块。
- `instagram_web_ad_filter.v1.3.2.sgmodule`：v1.3.2 回退模块。
- `instagram_web_ad_filter.v1.3.1.sgmodule`：v1.3.1 回退模块。

## 安装与回退

当前 v1.3.6：

```text
https://raw.githubusercontent.com/Shennai1/lon/main/Instagram/instagram_web_ad_filter.sgmodule?v=1.3.6
```

v1.3.5 实验备份：

```text
https://raw.githubusercontent.com/Shennai1/lon/main/Instagram/instagram_web_ad_filter.v1.3.5.sgmodule
```

回退到 v1.3.4：

```text
https://raw.githubusercontent.com/Shennai1/lon/main/Instagram/instagram_web_ad_filter.v1.3.4.sgmodule
```

回退到 v1.3.3：

```text
https://raw.githubusercontent.com/Shennai1/lon/main/Instagram/instagram_web_ad_filter.v1.3.3.sgmodule
```

回退到 v1.3.2：

```text
https://raw.githubusercontent.com/Shennai1/lon/main/Instagram/instagram_web_ad_filter.v1.3.2.sgmodule
```

回退到 v1.3.1：

```text
https://raw.githubusercontent.com/Shennai1/lon/main/Instagram/instagram_web_ad_filter.v1.3.1.sgmodule
```

## 启用条件

模块会把 `instagram.com`、`www.instagram.com` 和 `i.instagram.com` 加入 Surge MITM。HTTPS 解密必须启用，Surge CA 证书也必须受系统信任。

## 如何判断脚本在运行

命中的 JSON 响应会带有类似响应头：

```text
X-Surge-IG-Ad-Filter: ran; mode=observe-only; detected=2; reasons=ad_object:2
```

`detected=N` 只表示脚本看到了高置信广告记录。v1.3.6 不会根据这个结果修改 JSON，因此它不能单独证明广告已在页面中被处理。

初始 HTML 命中时会出现：

```text
X-Surge-IG-Ad-Filter: ran; mode=html-hybrid; overlay-rate=1/2; injected=1
```

这表示混合过滤已注入。约一半命中广告会直接折叠，另一半会保留原文章高度并显示“已隐藏一条赞助内容”。

## 验证建议

1. 保持浏览器去广告插件关闭。
2. 完全退出 Instagram 网页 App，再重新打开。
3. 连续向下浏览多批首页内容，重点观察是否再次变空白。
4. 在 Surge Dashboard 中检查分页请求是否持续产生，以及响应头是否为 `mode=observe-only`。
5. 稳定性确认后，再比较开启和关闭模块时“赞助”内容的出现情况。

## 限制

- Instagram 使用私有且经常变化的接口和页面结构，规则可能需要随之更新。
- 安全模式刻意不删除网络响应，广告拦截能力会弱于浏览器内容拦截扩展。
- 为平衡观感和虚拟列表稳定性，约 1/2 广告位置仍会保留原高度并显示占位提示。
- v1.3.5 已证明 80% 直接折叠会在本次 Mac 实机测试中复现持续空白；50% 仍属于实验比例，不能视为已解决。
- 没有精确广告跳转链接的广告可能不会被 CSS 遮住。
- `max-size` 为 5 MiB，超过时 Surge 会跳过响应脚本。
