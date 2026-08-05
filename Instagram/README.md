# Instagram 网页去广告：Surge 验证版

这套文件用于回答两个不同的问题：

1. Surge 脚本有没有执行；
2. 脚本有没有识别并删除广告节点。

模块只处理 Instagram Web 常见的 GraphQL、Feed、Discover、Clips、Reels 和 Stories JSON 响应。脚本仅删除带有高置信广告标识的数组元素，不会按域名粗暴阻断 Instagram 的正常图片、视频或登录接口。

## 文件

- `instagram_web_ad_filter.sgmodule`：Surge 模块。
- `ig_ad_filter.js`：响应体过滤脚本。

GitHub 目录：

```text
https://github.com/Shennai1/lon/tree/main/Instagram
```

Surge 模块安装链接：

```text
https://raw.githubusercontent.com/Shennai1/lon/main/Instagram/instagram_web_ad_filter.sgmodule
```

脚本链接：

```text
https://raw.githubusercontent.com/Shennai1/lon/main/Instagram/ig_ad_filter.js
```

模块已直接引用上述 Raw 脚本地址，并设置为每 86400 秒检查一次脚本更新。以后修改 GitHub 中的 `ig_ad_filter.js` 即可，无需重新修改模块地址。

## 启用前

模块会把以下主机加入 Surge MITM：

- `instagram.com`
- `www.instagram.com`
- `i.instagram.com`

HTTPS 解密必须已经启用，并且 Surge CA 证书必须由系统信任，否则脚本无法读取响应体。不要把 MITM 范围扩大到无关域名。

## 如何确认脚本在运行

启用模块后，重新加载 Instagram 网页并浏览首页或 Reels。在 Surge 的请求详情/脚本日志中查找：

```text
[IG Ad Filter] ran; removed=N
```

匹配到的响应还会附带：

```text
X-Surge-IG-Ad-Filter: ran; removed=N
```

含义：

- `removed=0`：脚本已经执行，但这个响应中没有识别到广告节点。
- `removed=1` 或更大：脚本执行并删除了对应数量的广告节点。
- `skipped=invalid-json`：URL 匹配，但返回体不是可解析的 JSON。
- 完全没有日志或响应头：优先检查 MITM、证书、脚本路径和 URL 是否命中。

## 建议的对照验证

为了区分 uBlock Origin Lite 与 Surge 的效果：

1. 先启用此 Surge 模块，保持 uBO Lite 为“优化”，确认 Surge 日志中能看到 `ran`。
2. 暂时把 `instagram.com` 的 uBO Lite 模式改成“不过滤”，强制刷新 Instagram，再连续浏览多批首页和 Reels。
3. 如果 Surge 日志出现 `removed>0` 且广告没有展示，说明 Surge 脚本至少实际删除过广告节点。
4. 保持 uBO Lite 不过滤，再临时关闭 Surge 模块并重复测试，作为对照。
5. 测试完成后恢复你原来的 uBO Lite“优化”模式。

Instagram 的广告投放并非每次请求都会出现，因此一次 `removed=0` 不能证明脚本无效；相反，出现一次 `removed>0` 就能证明脚本确实修改过响应。

## 限制

- Instagram 是私有且经常变化的接口；字段或响应结构变化后可能需要更新检测逻辑。
- 规则刻意保守。没有明确广告标识的内容不会被删除，以降低误删普通帖子和付费合作内容的风险。
- `max-size` 设为 5 MiB。超过该大小时，Surge 会跳过脚本并原样传递响应，以避免不受控的内存占用。
- 这是验证版，模块启用了 `debug=true`。确认稳定后可把它改为 `debug=false`。
