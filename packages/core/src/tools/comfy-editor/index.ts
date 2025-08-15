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
    return this.workflow.nodes?.find((node) => node.title === title);
  }

  public findNodeById(id: number): ComfyNode | undefined {
    return this.workflow.nodes?.find((node) => node.id === id);
  }

  public updateNodeWidget(update: {
    nodeId?: number;
    nodeTitle?: string;
    widgetName: string;
    value: any;
  }): ComfyNode {
    let node: ComfyNode | undefined;

    if (update.nodeId !== undefined) {
      node = this.findNodeById(update.nodeId);
    } else if (update.nodeTitle !== undefined) {
      node = this.findNodeByTitle(update.nodeTitle);
    }

    if (!node) {
      if (update.nodeId !== undefined && update.nodeTitle !== undefined) {
        throw new Error(
          `Node with id '${update.nodeId}' or title '${update.nodeTitle}' not found.`,
        );
      } else if (update.nodeId !== undefined) {
        throw new Error(`Node with id '${update.nodeId}' not found.`);
      } else if (update.nodeTitle !== undefined) {
        throw new Error(`Node with title '${update.nodeTitle}' not found.`);
      } else {
        throw new Error('Either nodeId or nodeTitle must be provided.');
      }
    }

    const widgetIndex = node.widgets?.findIndex(
      (widget: any) => widget.name === update.widgetName,
    );
    if (widgetIndex === undefined || widgetIndex === -1) {
      throw new Error(
        `Widget with name '${update.widgetName}' not found in node '${node.title}'.`,
      );
    }

    if (!node.widgets_values) {
      node.widgets_values = [];
    }
    node.widgets_values[widgetIndex] = update.value;

    return node;
  }

  public serialize(): string {
    return JSON.stringify(this.workflow, null, 2);
  }
}
