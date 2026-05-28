import { Component, type ErrorInfo, type ReactNode } from "react";

type GraphErrorBoundaryProps = {
  children: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
};

type GraphErrorBoundaryState = {
  error: Error | null;
};

export class GraphErrorBoundary extends Component<GraphErrorBoundaryProps, GraphErrorBoundaryState> {
  state: GraphErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <section className="graph-error-panel" role="alert" aria-label="知识图谱渲染失败">
          <h2>知识图谱暂时无法渲染</h2>
          <p>当前对话内容仍然可用。已记录错误信息，可以切回阅读器继续查看正文。</p>
        </section>
      );
    }
    return this.props.children;
  }
}

