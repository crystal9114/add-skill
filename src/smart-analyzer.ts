import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

export interface AnalysisResult {
  installer: 'npm' | 'git' | 'other';
  dependencies: string[];
}

/**
 * Analyzes a directory (repo) to determine how it should be installed
 * and what dependencies it needs.
 */
export async function smartAnalyze(dirPath: string): Promise<AnalysisResult> {
  const files = await readdir(dirPath);
  const readmeFile = files.find((f) => f.toLowerCase() === 'readme.md');
  const readmeContent = readmeFile ? await readFile(join(dirPath, readmeFile), 'utf-8') : '';

  let pkgJsonContent = undefined;
  if (files.includes('package.json')) {
    try {
      pkgJsonContent = await readFile(join(dirPath, 'package.json'), 'utf-8');
    } catch {}
  }

  return analyzeContent(readmeContent, files, pkgJsonContent);
}

export function analyzeContent(
  readmeContent: string,
  fileList: string[],
  packageJsonContent?: string
): AnalysisResult {
  const dependencies = new Set<string>();
  let installer: 'npm' | 'git' | 'other' = 'git';

  // 1. README Analysis
  if (readmeContent) {
    if (
      readmeContent.match(/npm\s+install/i) ||
      readmeContent.match(/pnpm\s+add/i) ||
      readmeContent.match(/yarn\s+add/i)
    ) {
      installer = 'npm';
      dependencies.add('node');
    }

    if (readmeContent.match(/pip\s+install/i) || readmeContent.match(/poetry\s+add/i)) {
      dependencies.add('python');
    }

    if (readmeContent.match(/go\s+install/i) || readmeContent.match(/go\s+get/i)) {
      dependencies.add('go');
    }

    if (readmeContent.match(/cargo\s+install/i)) {
      dependencies.add('rust');
    }
  }

  // 2. File Structure Analysis
  if (fileList.includes('package.json') && packageJsonContent) {
    try {
      const pkgJson = JSON.parse(packageJsonContent);
      if (pkgJson.bin) {
        installer = 'npm';
      }
    } catch {}
  }

  if (fileList.includes('pnpm-lock.yaml')) {
    dependencies.add('pnpm');
  }

  if (
    fileList.includes('setup.py') ||
    fileList.includes('pyproject.toml') ||
    fileList.includes('requirements.txt')
  ) {
    dependencies.add('python');
  }

  return {
    installer,
    dependencies: Array.from(dependencies),
  };
}
