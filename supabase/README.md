# PONG-84 排行榜与账号上线

## 发布顺序

1. 恢复 Supabase 项目 `grfhbtszcrwdbrphaiaw`，确认可备份及访问 SQL Editor。把迁移应用到现有项目或同结构的预发布数据库。迁移保留原表和数据，同时撤销旧排行榜、封禁表和旧 RPC 的公开权限。安排前端和 SQL 在同一维护窗口上线。
2. 在 Cloudflare Turnstile 创建 Managed widget。验证实际部署域名后，将主机名加入 widget 的 Hostname Management，例如 `yricotf.github.io`。把公开 Site Key 填进 `assets/config.js` 的 `turnstileSiteKey`。
3. 在 Supabase Authentication 的 Bot and Abuse Protection 中开启 CAPTCHA，选 Cloudflare Turnstile 并填写 **Secret Key**。Secret Key 仅存放在 Supabase。启用邮箱确认，将实际游戏入口加入 Auth Redirect URLs。确认生产 SMTP 能给游戏玩家发送注册确认邮件。
4. 使用已确认邮箱的 Supabase Auth 账号作为管理员。通过 SQL Editor 将该账号的 UUID 加入允许名单。再部署 GitHub Pages，在管理页用该账号登录。无需沿用旧共享管理密码。

```sql
insert into pong84_private.admins (user_id)
select id from auth.users
where lower(email) = lower('replace-with-your-admin@example.com')
  and email_confirmed_at is not null
on conflict do nothing;
```

## 验证

- 访客可玩、可读榜。注册或登录时完成 Turnstile，服务端会校验 token。登录后设置昵称，再完成一局可计分的人机对战。
- 旧累计战绩保留在管理页的历史记录。本机存档仍可在游戏内查看。全球榜从新账户的排位对局开始，时长仅累计已正常结算的排位对局。
- 匿名和普通账号只可通过新 RPC 读取公开榜单；账号校验、单局结算和管理权限都由服务端执行。新账号可按账号封禁。旧 IP 封禁记录由管理页保留，排位接口校验账号和设备。
- Supabase 验证对局存在、账号归属、时间和比分边界，并计算分数。球和球拍仍在浏览器模拟，高强度反作弊需要服务端模拟或可验证回放。
