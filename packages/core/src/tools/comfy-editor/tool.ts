import { ComfyWorkflow } from './index.js';
import { readFile, writeFile } from 'fs/promises';

export interface WidgetUpdate {
  nodeTitle: string;
  widgetName: string;
  value: any;
}

export async function executeWorkflowUpdates(filePath: string, updates: WidgetUpdate[]): Promise<void> {
  const fileContent = await readFile(filePath);
  const workflow = new ComfyWorkflow(fileContent.toString('utf-8'));
  
  for (const update of updates) {
    workflow.updateNodeWidget(update.nodeTitle, update.widgetName, update.value);
  }
  
  const newContent = workflow.serialize();
  await writeFile(filePath, newContent);
}