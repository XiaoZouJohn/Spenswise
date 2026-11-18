# 成就演示数据

此目录的 CSV 是虚构交易，覆盖 2026 年 6 月至 11 月，金额由固定随机种子生成。商户和收入来源采用真实企业名称，但交易关系与金额均为演示内容。

本机运行：

```powershell
cd backend
$env:DATABASE_URL = 'sqlite:///./spendwise-dev.db'
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m scripts.seed_achievement_demo
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

登录邮箱是 `achievement.demo@spendwise.local`。密码保存在本机忽略目录 `backend/uploads/achievement-demo-credentials.txt`。默认 VS Code 开发配置直接使用 `backend/spendwise-dev.db`，可照常启动前后端。启动前确认 8000 端口没有其他开发服务。

种子脚本仅允许显式指定默认开发库或独立演示库，不修改其他账号的数据。重复运行会校验账单指纹、避免重复写入，并沿用已保存的演示密码。登录历史中的连续 7 天为显式合成测试数据。五个已结束月份均有月度回顾和消费预算，满足连续 2/3 月的成就条件；另有五篇生活日志。

名称核对：[字节跳动](https://www.bytedance.com/about?locale=zh)、[美团](https://www.meituan.com/)、[京东](https://ir.jd.com/zh-hans)、[盒马](https://www.alibabagroup.com/zh-HK/about-alibaba-businesses-1747800973536919552)、[中国移动](https://www.10086.cn/aboutus/culture/intro/index/index_detail_45977.html)、[滴滴](https://dpubstatic.udache.com/static/dpubimg/b7ff8f58-2442-4afa-a36e-0f7c0fe2eadf.pdf)、[自如](https://apps.apple.com/cn/app/%E8%87%AA%E5%A6%82/id685872176)、[星巴克](https://www.starbucks.com.cn/about)。
