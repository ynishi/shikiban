interface ComfyNode {
  id: number;
  type: string;
  title: string;
  [key: string]: any;
}

interface ComfyWorkflowData {
  last_node_id: number;
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

  public findNodesByType(type: string): ComfyNode[] {
    return this.workflow.nodes?.filter((node) => node.type === type) || [];
  }

  public updateNodeWidget(update: {
    nodeId?: number;
    nodeTitle?: string;
    nodeType?: string;
    widgetName: string;
    value: any;
  }): ComfyNode[] {
    let nodesToUpdate: ComfyNode[] = [];

    if (update.nodeId !== undefined) {
      const node = this.findNodeById(update.nodeId);
      if (node) {
        nodesToUpdate.push(node);
      }
    } else if (update.nodeTitle !== undefined) {
      const node = this.findNodeByTitle(update.nodeTitle);
      if (node) {
        nodesToUpdate.push(node);
      }
    } else if (update.nodeType !== undefined) {
      nodesToUpdate = this.findNodesByType(update.nodeType);
    }

    if (nodesToUpdate.length === 0) {
      if (update.nodeId !== undefined) {
        throw new Error(`Node with id '${update.nodeId}' not found.`);
      } else if (update.nodeTitle !== undefined) {
        throw new Error(`Node with title '${update.nodeTitle}' not found.`);
      } else if (update.nodeType !== undefined) {
        throw new Error(`No nodes with type '${update.nodeType}' found.`);
      } else {
        throw new Error(
          'Either nodeId, nodeTitle, or nodeType must be provided.',
        );
      }
    }

    for (const node of nodesToUpdate) {
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
    }

    return nodesToUpdate;
  }

  public serialize(): string {
    return JSON.stringify(this.workflow, null, 2);
  }

  public addNode(node: ComfyNode): void {
    if (this.workflow.last_node_id === undefined) {
      this.workflow.last_node_id =
        this.workflow.nodes.length > 0
          ? Math.max(...this.workflow.nodes.map((n) => n.id))
          : 0;
    }
    this.workflow.last_node_id += 1;
    node.id = this.workflow.last_node_id;
    this.workflow.nodes.push(node);
  }
}
