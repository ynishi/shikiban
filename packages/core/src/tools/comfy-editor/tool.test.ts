import { vi, describe, it, expect, beforeEach } from 'vitest';
import { readFile, writeFile } from 'fs/promises';
import { executeWorkflowUpdates } from './tool.js';

vi.mock('fs/promises');

describe('executeWorkflowUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should read workflow, update widgets, and write back', async () => {
    const mockWorkflowJson = {
      nodes: [
        {
          id: 3,
          type: 'KSampler',
          title: 'KSampler',
          pos: [863, 186],
          size: { 0: 315, 1: 262 },
          flags: {},
          order: 6,
          mode: 0,
          inputs: [
            { name: 'model', type: 'MODEL', link: 1 },
            { name: 'positive', type: 'CONDITIONING', link: 4 },
            { name: 'negative', type: 'CONDITIONING', link: 6 },
            { name: 'latent_image', type: 'LATENT', link: 2 }
          ],
          outputs: [
            { name: 'LATENT', type: 'LATENT', links: [7], slot_index: 0 }
          ],
          properties: { 'Node name for S&R': 'KSampler' },
          widgets: [
            { name: 'seed', type: 'number' },
            { name: 'control_after_generate', type: 'combo' },
            { name: 'steps', type: 'number' },
            { name: 'cfg', type: 'number' },
            { name: 'sampler_name', type: 'combo' },
            { name: 'scheduler', type: 'combo' },
            { name: 'denoise', type: 'number' }
          ],
          widgets_values: [156680208700286, 'randomize', 20, 8, 'euler', 'normal', 1]
        }
      ],
      links: [],
      groups: [],
      config: {},
      extra: {},
      version: 0.4
    };

    vi.mocked(readFile).mockResolvedValue(Buffer.from(JSON.stringify(mockWorkflowJson, null, 2)));
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const updates = [
      { nodeTitle: 'KSampler', widgetName: 'seed', value: 123456789 },
      { nodeTitle: 'KSampler', widgetName: 'steps', value: 30 }
    ];

    await executeWorkflowUpdates('dummy/path/workflow.json', updates);

    expect(readFile).toHaveBeenCalledWith('dummy/path/workflow.json');
    expect(writeFile).toHaveBeenCalledWith('dummy/path/workflow.json', expect.any(String));

    const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
    const writtenWorkflow = JSON.parse(writtenContent);
    
    const kSamplerNode = writtenWorkflow.nodes.find((n: any) => n.type === 'KSampler');
    expect(kSamplerNode.widgets_values[0]).toBe(123456789);
    expect(kSamplerNode.widgets_values[2]).toBe(30);
  });
});