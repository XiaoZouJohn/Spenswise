# 本地字体

Story 使用本地 WOFF2 子集，无运行时外部字体请求。

- `lora-500.woff2`：Lora 500，来自 Google Fonts。
- `noto-sans-sc.woff2`：Noto Sans SC 可变字重，基于本机安装的 Noto Sans SC 字体。
- `noto-serif-sc.woff2`：Noto Serif SC 可变字重，基于本机安装的 Noto Serif SC 字体。

字体仅保留当前前后端文案所需的字形及基本拉丁字符；用户生成的罕见字符会回退到系统字体。三个 `OFL-*.txt` 文件分别保留原字体许可。网站通过 CSS 指向这些本地资源。
