/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { ComfyWorkflow } from './index.js';

describe('ComfyWorkflow', () => {
  it('should correctly parse valid JSON', () => {
    const validJson = '{"nodes": [], "links": []}';
    const workflow = new ComfyWorkflow(validJson);
    expect(workflow.getRawWorkflow()).toEqual({ nodes: [], links: [] });
  });

  it('should throw an error for invalid JSON', () => {
    const invalidJson = '{"nodes": [}';
    const createWorkflow = () => new ComfyWorkflow(invalidJson);
    expect(createWorkflow).toThrow('Invalid ComfyUI workflow JSON');
  });

  describe('findNodeByTitle', () => {
    const sampleWorkflowJson = JSON.stringify({
      nodes: [
        {
          id: 1,
          type: 'CheckpointLoaderSimple',
          title: 'Load Checkpoint',
          pos: [100, 100],
          size: { 0: 315, 1: 98 },
          flags: {},
          order: 0,
          mode: 0,
          outputs: [
            { name: 'MODEL', type: 'MODEL', links: [1], slot_index: 0 },
            { name: 'CLIP', type: 'CLIP', links: [3, 5], slot_index: 1 },
            { name: 'VAE', type: 'VAE', links: [8], slot_index: 2 }
          ],
          properties: { 'Node name for S&R': 'CheckpointLoaderSimple' },
          widgets_values: ['sd_xl_base_1.0.safetensors']
        },
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
          widgets_values: [156680208700286, 'randomize', 20, 8, 'euler', 'normal', 1]
        }
      ],
      links: [],
      groups: [],
      config: {},
      extra: {},
      version: 0.4
    });

    it('should return the correct node when a title exists', () => {
      const workflow = new ComfyWorkflow(sampleWorkflowJson);
      const node = workflow.findNodeByTitle('KSampler');
      
      expect(node).toBeDefined();
      expect(node?.id).toBe(3);
      expect(node?.type).toBe('KSampler');
      expect(node?.title).toBe('KSampler');
    });

    it('should return undefined when a title does not exist', () => {
      const workflow = new ComfyWorkflow(sampleWorkflowJson);
      const node = workflow.findNodeByTitle('Empty Latent Image');
      
      expect(node).toBeUndefined();
    });
  });

  describe('updateNodeWidget', () => {
    const detailedWorkflowJson = JSON.stringify({
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
        },
        {
          id: 1,
          type: 'CheckpointLoaderSimple',
          title: 'Load Checkpoint',
          pos: [100, 100],
          size: { 0: 315, 1: 98 },
          flags: {},
          order: 0,
          mode: 0,
          outputs: [
            { name: 'MODEL', type: 'MODEL', links: [1], slot_index: 0 },
            { name: 'CLIP', type: 'CLIP', links: [3, 5], slot_index: 1 },
            { name: 'VAE', type: 'VAE', links: [8], slot_index: 2 }
          ],
          properties: { 'Node name for S&R': 'CheckpointLoaderSimple' },
          widgets: [
            { name: 'ckpt_name', type: 'combo' }
          ],
          widgets_values: ['sd_xl_base_1.0.safetensors']
        }
      ],
      links: [],
      groups: [],
      config: {},
      extra: {},
      version: 0.4
    });

    it('should update a widget\'s value successfully', () => {
      const workflow = new ComfyWorkflow(detailedWorkflowJson);
      const updatedNode = workflow.updateNodeWidget('KSampler', 'seed', 999);
      
      expect(updatedNode).toBeDefined();
      expect(updatedNode.widgets_values[0]).toBe(999);
    });

    it('should throw an error if the node title does not exist', () => {
      const workflow = new ComfyWorkflow(detailedWorkflowJson);
      
      expect(() => {
        workflow.updateNodeWidget('NonExistentNode', 'seed', 123);
      }).toThrow('Node with title \'NonExistentNode\' not found.');
    });

    it('should throw an error if the widget name does not exist', () => {
      const workflow = new ComfyWorkflow(detailedWorkflowJson);
      
      expect(() => {
        workflow.updateNodeWidget('KSampler', 'non_existent_widget', 123);
      }).toThrow('Widget with name \'non_existent_widget\' not found in node \'KSampler\'.');
    });
  });

  describe('serialize', () => {
    it('should serialize the workflow back to a valid JSON string', () => {
      const sampleWorkflowJson = JSON.stringify({
        nodes: [
          {
            id: 1,
            type: 'CheckpointLoaderSimple',
            title: 'Load Checkpoint',
            widgets_values: ['model.safetensors']
          }
        ],
        links: [],
        version: 0.4
      });

      const workflow = new ComfyWorkflow(sampleWorkflowJson);
      const serialized = workflow.serialize();
      const reparsed = JSON.parse(serialized);

      expect(reparsed).toEqual(workflow.getRawWorkflow());
    });

    it('should correctly serialize a modified workflow', () => {
      const detailedWorkflowJson = JSON.stringify({
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
      });

      const workflow = new ComfyWorkflow(detailedWorkflowJson);
      workflow.updateNodeWidget('KSampler', 'seed', 999);
      
      const serialized = workflow.serialize();
      const reparsed = JSON.parse(serialized);
      
      const kSamplerNode = reparsed.nodes.find((node: any) => node.title === 'KSampler');
      expect(kSamplerNode.widgets_values[0]).toBe(999);
    });
  });
});