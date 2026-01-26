---
name: add-skill
description: 开放式 Agent 技能管理工具。向当前 Agent 添加新技能、指令集或工具。支持从 GitHub、Gist 或本地路径安装。
user-invocable: true
---

# Add Skill

`add-skill` 是一个功能强大的 CLI 工具，允许你动态扩展 Agent 的能力。

## 常用命令

- `/add-skill <repo-url>`: 从指定的 GitHub 仓库安装新技能。
- `/add-skill --help`: 查看所有可用选项和支持的 Agent 列表。

## 支持的 Agent
- Antigravity
- Claude Code
- Cursor
- ... 以及更多

> [!TIP]
> 这是一个系统级工具，执行后通常需要重启 Agent 或运行同步脚本（如 `update-all.ps1`）来使新技能生效。
