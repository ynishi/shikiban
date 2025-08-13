interface ComfyNode {
  id: number;
  type: string;
  title: string;
  [key: string]: any;
}

interface ComfyWorkflowData {
  nodes: ComfyNode[];
  [key: string]: any;
}

/**
 * ComfyWorkflow class for parsing and manipulating ComfyUI workflow JSON
 */
export class ComfyWorkflow {
  private jsonContent: string;
  // TODO: Define a more specific TypeScript interface to replace 'any' for better type safety
  private workflow: ComfyWorkflowData;

  constructor(jsonContent: string) {
    this.jsonContent = jsonContent;
    try {
      this.workflow = JSON.parse(jsonContent);
    } catch (error) {
      console.error('Failed to parse ComfyUI workflow JSON:', error);
      throw new Error('Invalid ComfyUI workflow JSON');
    }
  }

  public getRawWorkflow(): any {
    return this.workflow;
  }

  public findNodeByTitle(title: string): ComfyNode | undefined {
    return this.workflow.nodes?.find(node => node.title === title);
  }

  public updateNodeWidget(nodeTitle: string, widgetName: string, value: any): ComfyNode {
    const node = this.findNodeByTitle(nodeTitle);
    if (!node) {
      throw new Error(`Node with title '${nodeTitle}' not found.`);
    }

    const widgetIndex = node.widgets?.findIndex((widget: any) => widget.name === widgetName);
    if (widgetIndex === undefined || widgetIndex === -1) {
      throw new Error(`Widget with name '${widgetName}' not found in node '${nodeTitle}'.`);
    }

    if (!node.widgets_values) {
      node.widgets_values = [];
    }
    node.widgets_values[widgetIndex] = value;

    return node;
  }

  public serialize(): string {
    return JSON.stringify(this.workflow, null, 2);
  }
}