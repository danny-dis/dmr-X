import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { loadAgentFromConfig, loadAgentsFromDirectory } from '../../services/agent-registry/src/agent-config-loader.js';

describe('agent-config-loader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('loadAgentFromConfig', () => {
    it('should load a JSON config file', () => {
      const configPath = path.join(tmpDir, 'test-agent.json');
      fs.writeFileSync(configPath, JSON.stringify({
        name: 'JSON Agent',
        description: 'Loaded from JSON',
        systemPrompt: 'You are helpful',
        preferredModel: 'claude-3-5-sonnet',
        allowedTools: ['dmrx_chat'],
      }));

      const result = loadAgentFromConfig(configPath);
      expect(result).not.toBeNull();
      expect(result!.definition.name).toBe('JSON Agent');
      expect(result!.definition.systemPrompt).toBe('You are helpful');
      expect(result!.definition.allowedTools).toEqual(['dmrx_chat']);
    });

    it('should load a .agent config file', () => {
      const configPath = path.join(tmpDir, 'test.agent');
      fs.writeFileSync(configPath, `name: YAML Agent
description: Loaded from .agent
systemPrompt: You are a test agent
preferredModel: auto
visibility: public
category: Testing
`);

      const result = loadAgentFromConfig(configPath);
      expect(result).not.toBeNull();
      expect(result!.definition.name).toBe('YAML Agent');
      expect(result!.definition.systemPrompt).toBe('You are a test agent');
      expect(result!.definition.visibility).toBe('public');
      expect(result!.definition.category).toBe('Testing');
    });

    it('should reject config without name', () => {
      const configPath = path.join(tmpDir, 'no-name.json');
      fs.writeFileSync(configPath, JSON.stringify({ description: 'No name' }));

      const result = loadAgentFromConfig(configPath);
      expect(result).toBeNull();
    });

    it('should handle missing file gracefully', () => {
      const result = loadAgentFromConfig(path.join(tmpDir, 'nonexistent.json'));
      expect(result).toBeNull();
    });

    it('should handle malformed JSON gracefully', () => {
      const configPath = path.join(tmpDir, 'bad.json');
      fs.writeFileSync(configPath, '{ invalid json }');

      const result = loadAgentFromConfig(configPath);
      expect(result).toBeNull();
    });

    it('should default modelTier to auto', () => {
      const configPath = path.join(tmpDir, 'agent.json');
      fs.writeFileSync(configPath, JSON.stringify({ name: 'Agent' }));

      const result = loadAgentFromConfig(configPath);
      expect(result!.definition.modelTier).toBe('auto');
    });
  });

  describe('loadAgentsFromDirectory', () => {
    it('should load all agents from a directory', () => {
      fs.writeFileSync(path.join(tmpDir, 'agent1.json'), JSON.stringify({ name: 'Agent 1' }));
      fs.writeFileSync(path.join(tmpDir, 'agent2.json'), JSON.stringify({ name: 'Agent 2' }));
      fs.writeFileSync(path.join(tmpDir, 'agent3.agent'), 'name: Agent 3\n');

      const results = loadAgentsFromDirectory(tmpDir);
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.definition.name)).toEqual(
        expect.arrayContaining(['Agent 1', 'Agent 2', 'Agent 3'])
      );
    });

    it('should skip non-agent files', () => {
      fs.writeFileSync(path.join(tmpDir, 'agent.json'), JSON.stringify({ name: 'Agent' }));
      fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'Not an agent');
      fs.writeFileSync(path.join(tmpDir, 'config.yaml'), 'name: Not loaded');

      const results = loadAgentsFromDirectory(tmpDir);
      expect(results).toHaveLength(1);
      expect(results[0].definition.name).toBe('Agent');
    });

    it('should recurse into subdirectories', () => {
      const subDir = path.join(tmpDir, 'sub');
      fs.mkdirSync(subDir);
      fs.writeFileSync(path.join(tmpDir, 'agent1.json'), JSON.stringify({ name: 'Agent 1' }));
      fs.writeFileSync(path.join(subDir, 'agent2.json'), JSON.stringify({ name: 'Agent 2' }));

      const results = loadAgentsFromDirectory(tmpDir);
      expect(results).toHaveLength(2);
    });

    it('should handle empty directory', () => {
      const results = loadAgentsFromDirectory(tmpDir);
      expect(results).toHaveLength(0);
    });

    it('should handle nonexistent directory', () => {
      const results = loadAgentsFromDirectory(path.join(tmpDir, 'nonexistent'));
      expect(results).toHaveLength(0);
    });
  });
});
