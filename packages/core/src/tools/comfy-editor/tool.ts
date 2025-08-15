import { ComfyWorkflow } from './index.js';
import { readFile, writeFile } from 'fs/promises';

export interface WorkflowUpdateOperation {
  action?: 'add_node' | 'update_widget';
  // For adding nodes
  node?: any;
  // For updating widgets
  nodeId?: number;
  nodeTitle?: string;
  nodeType?: string;
  widgetName?: string;
  value?: any;
}

export async function executeWorkflowUpdates(
  filePath: string,
  updates: WorkflowUpdateOperation[],
): Promise<void> {
  const fileContent = await readFile(filePath);
  const workflow = new ComfyWorkflow(fileContent.toString('utf-8'));

  for (const update of updates) {
    const action = update.action || 'update_widget'; // Default to update_widget

    if (action === 'add_node') {
      if (!update.node) {
        throw new Error(`Action 'add_node' requires a 'node' property.`);
      }
      workflow.addNode(update.node);
    } else {
      workflow.updateNodeWidget(update as any);
    }
  }

  const newContent = workflow.serialize();
  await writeFile(filePath, newContent);
}
