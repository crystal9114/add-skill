/**
 * Manifest Installer - 简化版 Antigravity 技能安装器
 *
 * 核心逻辑：
 * 1. 远程检查 README（优先使用作者推荐的安装方式）
 * 2. 远程获取 SKILL.md 元数据
 * 3. 写入 skills-manifest.json
 * 4. 如需克隆仓库，自动 fork 到 crystal9114
 * 5. 联动 update-all.ps1 完成安装
 */

import { readFile, writeFile } from 'fs/promises';
import { join, basename } from 'path';
import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import matter from 'gray-matter';

// 配置常量
const SKILLS_ROOT = 'C:\\Users\\Administrator\\.gemini\\antigravity\\skills';
const MANIFEST_PATH = join(SKILLS_ROOT, 'skills-manifest.json');
const UPDATE_SCRIPT = join(SKILLS_ROOT, 'update-all.ps1');
const GITHUB_USER = 'crystal9114';

// 类型定义
export interface SkillEntry {
  name: string;
  description: string; // 必须是中文
  origin?: string; // fork 后的 URL
  upstream?: string; // 原始 URL
  installer?: 'npm' | 'git' | 'uipro';
  dependencies?: string[];
  commands?: string[];
  local?: boolean;
}

export interface SkillMetadata {
  name: string;
  description: string;
  userInvocable?: boolean;
  allowedTools?: string[];
  metadata?: Record<string, unknown>;
}

export interface InstallResult {
  success: boolean;
  message: string;
  entry?: SkillEntry;
}

/**
 * 解析 GitHub URL，提取 owner 和 repo
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  // 支持多种格式：
  // https://github.com/owner/repo
  // https://github.com/owner/repo.git
  // git@github.com:owner/repo.git
  // owner/repo (简写)

  const patterns = [/github\.com[/:]([\w-]+)\/([\w-]+?)(?:\.git)?$/, /^([\w-]+)\/([\w-]+)$/];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return { owner: match[1]!, repo: match[2]! };
    }
  }

  return null;
}

/**
 * 远程获取 README 内容（不克隆仓库）
 * 使用 GitHub API 或 raw.githubusercontent.com
 */
export async function fetchRemoteReadme(repoUrl: string): Promise<string | null> {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) return null;

  const { owner, repo } = parsed;

  // 尝试 raw.githubusercontent.com（无需 API 令牌）
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`;
  const rawUrlMaster = `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`;

  for (const url of [rawUrl, rawUrlMaster]) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.text();
      }
    } catch {
      // 继续尝试下一个 URL
    }
  }

  // 备选：使用 GitHub API
  try {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/readme`;
    const response = await fetch(apiUrl, {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        'User-Agent': 'add-skill-cli',
      },
    });
    if (response.ok) {
      return await response.text();
    }
  } catch {
    // 忽略
  }

  return null;
}

/**
 * 远程获取 SKILL.md 内容
 * 尝试多个常见位置
 */
export async function fetchRemoteSkillMd(repoUrl: string): Promise<SkillMetadata | null> {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) return null;

  const { owner, repo } = parsed;

  // 尝试的路径列表
  const paths = [
    'SKILL.md',
    'skill.md',
    'skills/SKILL.md',
    '.claude/skills/SKILL.md',
    '.gemini/skills/SKILL.md',
  ];

  for (const path of paths) {
    for (const branch of ['main', 'master']) {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
      try {
        const response = await fetch(url);
        if (response.ok) {
          const content = await response.text();
          const parsed = matter(content);
          if (parsed.data.name && parsed.data.description) {
            return {
              name: parsed.data.name as string,
              description: parsed.data.description as string,
              userInvocable: parsed.data['user-invocable'] as boolean | undefined,
              allowedTools: parsed.data['allowed-tools'] as string[] | undefined,
              metadata: parsed.data.metadata as Record<string, unknown> | undefined,
            };
          }
        }
      } catch {
        // 继续尝试
      }
    }
  }

  return null;
}

/**
 * 分析 README，检测作者推荐的安装方式
 */
export interface InstallMethod {
  type: 'npm' | 'pip' | 'git' | 'curl' | 'manual' | 'unknown';
  command?: string;
  needsClone: boolean;
}

export function detectInstallMethod(readme: string): InstallMethod {
  const lower = readme.toLowerCase();

  // 检测 npm/npx 安装
  const npmMatch = readme.match(
    /```(?:bash|shell|sh)?\s*\n\s*(npx?\s+(?:install|skills|add)[^\n]+)/i
  );
  if (npmMatch) {
    return { type: 'npm', command: npmMatch[1]?.trim(), needsClone: false };
  }

  // 检测 pip 安装
  const pipMatch = readme.match(/```(?:bash|shell|sh)?\s*\n\s*(pip\s+install[^\n]+)/i);
  if (pipMatch) {
    return { type: 'pip', command: pipMatch[1]?.trim(), needsClone: false };
  }

  // 检测 curl/wget 安装
  const curlMatch = readme.match(/```(?:bash|shell|sh)?\s*\n\s*((?:curl|wget)[^\n]+)/i);
  if (curlMatch) {
    return { type: 'curl', command: curlMatch[1]?.trim(), needsClone: false };
  }

  // 检测 git clone 推荐
  if (lower.includes('git clone') || lower.includes('clone this repository')) {
    return { type: 'git', needsClone: true };
  }

  // 默认：需要克隆
  return { type: 'unknown', needsClone: true };
}

/**
 * 使用 gh CLI 自动 fork 仓库
 */
export async function autoFork(upstreamUrl: string): Promise<string | null> {
  const parsed = parseGitHubUrl(upstreamUrl);
  if (!parsed) return null;

  const { owner, repo } = parsed;

  // 如果已经是自己的仓库，直接返回
  if (owner.toLowerCase() === GITHUB_USER.toLowerCase()) {
    return upstreamUrl;
  }

  try {
    // 检查是否已经有 fork
    const checkCmd = `gh repo view ${GITHUB_USER}/${repo} --json url -q .url 2>nul`;
    const existingFork = execSync(checkCmd, { encoding: 'utf-8' }).trim();
    if (existingFork) {
      console.log(`   Fork already exists: ${existingFork}`);
      return existingFork;
    }
  } catch {
    // Fork 不存在，继续创建
  }

  try {
    // 创建 fork
    console.log(`   Forking ${owner}/${repo} to ${GITHUB_USER}...`);
    execSync(`gh repo fork ${owner}/${repo} --clone=false`, { encoding: 'utf-8' });

    // 返回 fork URL
    return `https://github.com/${GITHUB_USER}/${repo}.git`;
  } catch (error) {
    console.error(`   Failed to fork: ${error}`);
    return null;
  }
}

/**
 * 读取现有的 manifest
 */
export async function loadManifest(): Promise<{ skills: SkillEntry[] }> {
  try {
    const content = await readFile(MANIFEST_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { skills: [] };
  }
}

/**
 * 保存 manifest
 */
export async function saveManifest(manifest: { skills: SkillEntry[] }): Promise<void> {
  const content = JSON.stringify(manifest, null, 2);
  await writeFile(MANIFEST_PATH, content, 'utf-8');
}

/**
 * 添加技能到 manifest
 */
export async function addToManifest(entry: SkillEntry): Promise<void> {
  const manifest = await loadManifest();

  // 检查是否已存在
  const existingIndex = manifest.skills.findIndex(
    (s) => s.name.toLowerCase() === entry.name.toLowerCase()
  );

  if (existingIndex >= 0) {
    // 更新现有条目
    manifest.skills[existingIndex] = entry;
    console.log(`   Updated existing entry: ${entry.name}`);
  } else {
    // 添加新条目
    manifest.skills.push(entry);
    console.log(`   Added new entry: ${entry.name}`);
  }

  await saveManifest(manifest);
}

/**
 * 运行 update-all.ps1 脚本
 */
export function runUpdateScript(): void {
  if (!existsSync(UPDATE_SCRIPT)) {
    console.error(`   Error: update-all.ps1 not found at ${UPDATE_SCRIPT}`);
    return;
  }

  console.log('\n   Running update-all.ps1...');
  const child = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', UPDATE_SCRIPT], {
    cwd: SKILLS_ROOT,
    stdio: 'inherit',
  });

  child.on('close', (code) => {
    if (code === 0) {
      console.log('   Update completed successfully!');
    } else {
      console.error(`   Update script exited with code ${code}`);
    }
  });
}

/**
 * 主安装函数
 */
export async function installSkill(
  repoUrl: string,
  options: {
    fork?: boolean;
    noSync?: boolean;
    description?: string; // 用户指定的中文描述
  } = {}
): Promise<InstallResult> {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) {
    return { success: false, message: '无法解析 GitHub URL' };
  }

  const { owner, repo } = parsed;
  console.log(`\n🔍 Analyzing ${owner}/${repo}...`);

  // 1. 获取 README
  const readme = await fetchRemoteReadme(repoUrl);
  if (!readme) {
    console.log('   Warning: Could not fetch README');
  }

  // 2. 获取 SKILL.md
  const skillMd = await fetchRemoteSkillMd(repoUrl);
  const skillName = skillMd?.name || repo;
  let description = options.description || skillMd?.description || '';

  // 检查描述是否为中文
  const isChinese = /[\u4e00-\u9fa5]/.test(description);
  if (!isChinese && description) {
    console.log(`   Warning: Description is not in Chinese: "${description}"`);
    console.log('   Please provide a Chinese description using --desc option');
  }

  // 3. 检测安装方式
  let installMethod: InstallMethod = { type: 'unknown', needsClone: true };
  if (readme) {
    installMethod = detectInstallMethod(readme);
    console.log(`   Detected install method: ${installMethod.type}`);
    if (installMethod.command) {
      console.log(`   Recommended command: ${installMethod.command}`);
    }
  }

  // 4. 准备 manifest 条目
  const entry: SkillEntry = {
    name: skillName,
    description: description || `${repo} 技能`,
    commands: skillMd?.userInvocable ? [`/${skillName}`] : undefined,
  };

  // 5. 根据安装方式决定是否需要 fork
  if (installMethod.needsClone || options.fork) {
    // 需要克隆仓库，执行 fork
    const upstreamUrl = `https://github.com/${owner}/${repo}.git`;
    const originUrl = await autoFork(upstreamUrl);

    if (originUrl) {
      entry.origin = originUrl;
      if (owner.toLowerCase() !== GITHUB_USER.toLowerCase()) {
        entry.upstream = upstreamUrl;
      }
    } else {
      // Fork 失败，直接使用原始 URL
      entry.origin = upstreamUrl;
    }

    // 根据内容设置 installer
    if (
      readme?.toLowerCase().includes('npm install') ||
      readme?.toLowerCase().includes('package.json')
    ) {
      entry.installer = 'npm';
      entry.dependencies = ['pnpm'];
    }
  } else {
    // 不需要克隆，记录安装方式
    if (installMethod.type === 'npm' && installMethod.command) {
      entry.installer = 'npm';
    }
  }

  // 6. 写入 manifest
  console.log('\n📝 Writing to skills-manifest.json...');
  await addToManifest(entry);

  // 7. 运行更新脚本
  if (!options.noSync) {
    runUpdateScript();
  }

  return {
    success: true,
    message: `Successfully added ${skillName} to manifest`,
    entry,
  };
}

// CLI 入口（可选）
export async function main(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.log('Usage: add-skill <repo-url> [--fork] [--no-sync] [--desc "中文描述"]');
    return;
  }

  const repoUrl = args[0]!;
  const options = {
    fork: args.includes('--fork'),
    noSync: args.includes('--no-sync'),
    description: (() => {
      const descIndex = args.indexOf('--desc');
      return descIndex >= 0 ? args[descIndex + 1] : undefined;
    })(),
  };

  const result = await installSkill(repoUrl, options);
  console.log(`\n${result.success ? '✅' : '❌'} ${result.message}`);
}
