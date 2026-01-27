import { readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import * as p from '@clack/prompts';
import chalk from 'chalk';

interface SkillManifestEntry {
  name: string;
  description: string;
  origin: string;
  upstream: string | null;
  installer: string;
  dependencies: string[];
  commands: string[];
}

interface Manifest {
  skills: SkillManifestEntry[];
}

export async function updateManifest(entry: SkillManifestEntry): Promise<void> {
  // Look for skills-manifest.json in the current working directory or parent
  // Assuming the user runs this from the 'skills' folder or the root of the project
  let manifestPath = join(process.cwd(), 'skills-manifest.json');

  if (!existsSync(manifestPath)) {
    // Try parent directory if we are in a subfolder (e.g. skills/add-skill)
    manifestPath = join(process.cwd(), '..', 'skills-manifest.json');
    if (!existsSync(manifestPath)) {
      p.log.warn(chalk.yellow('Could not find skills-manifest.json to update locally.'));
      return;
    }
  }

  try {
    const content = await readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(content) as Manifest;

    // Check if skill already exists
    const existingIndex = manifest.skills.findIndex((s) => s.name === entry.name);

    if (existingIndex >= 0) {
      // Update existing
      manifest.skills[existingIndex] = { ...manifest.skills[existingIndex], ...entry };
      p.log.success(`Updated entry for ${entry.name} in skills-manifest.json`);
    } else {
      // Add new
      manifest.skills.push(entry);
      p.log.success(`Added ${entry.name} to skills-manifest.json`);
    }

    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  } catch (err) {
    p.log.error(`Failed to update skills-manifest.json: ${err}`);
  }
}

export async function triggerUpdateScript(): Promise<void> {
  const platform = process.platform;
  let command = '';
  let args: string[] = [];

  // Assuming update-all.ps1 is in the same directory as the manifest
  const scriptDir = join(process.cwd()); // Or determined relative to manifest
  // Actually, simpler to assume we are in the 'skills' folder context

  if (platform === 'win32') {
    command = 'powershell';
    args = ['-ExecutionPolicy', 'Bypass', '-File', './update-all.ps1'];
  } else {
    // Fallback for non-windows (though user is on windows)
    p.log.warn('Auto-update script is currently Windows-only.');
    return;
  }

  p.log.info('Triggering One-Click Sync (update-all.ps1)...');

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', cwd: scriptDir });

    child.on('close', (code) => {
      if (code === 0) {
        p.log.success('Sync completed successfully.');
        resolve();
      } else {
        p.log.error(`Sync script failed with code ${code}.`);
        resolve(); // Resolve anyway to not break the flow
      }
    });

    child.on('error', (err) => {
      p.log.error(`Failed to start sync script: ${err.message}`);
      resolve();
    });
  });
}
