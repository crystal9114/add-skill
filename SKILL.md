---
name: add-skill
description: Antigravity 技能管理工具。从 GitHub 添加技能到 manifest，自动配置 fork 和 upstream。
user-invocable: true
---

# Add Skill

快速添加新技能到 `skills-manifest.json`，配合 `update-all.ps1` 完成安装。

## 推荐用法（Antigravity）

```bash
/add-skill manifest <repo-url>
/add-skill manifest <repo-url> --fork          # 自动 fork 后添加
/add-skill manifest <repo-url> --desc "描述"   # 指定中文描述
```

## 安装流程

1. 远程检查仓库的 README 和 SKILL.md（不克隆整个仓库）
2. 检测作者推荐的安装方式（npm/pip/git clone）
3. 如需克隆仓库，自动 fork 到 crystal9114
4. 写入 `skills-manifest.json`（含中文描述、origin、upstream）
5. 运行 `update-all.ps1` 完成安装

## 选项

| 选项 | 说明 |
|------|------|
| `--fork` | 强制 fork 仓库到 crystal9114 |
| `--no-sync` | 仅写入 manifest，不运行 update-all.ps1 |
| `--desc "..."` | 指定中文描述，覆盖自动检测 |

> [!TIP]
> 安装完成后，新技能会显示在 README 技能表格中，并自动添加到 `.gitignore`。

