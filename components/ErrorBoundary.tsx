import React from "react";
export default class ErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() { return this.state.error ? <div className="grid min-h-screen place-items-center bg-[#070b12] p-8 text-center text-slate-200"><div><h1 className="text-xl font-semibold">Workspace error</h1><p className="mt-2 text-sm text-slate-400">{this.state.error.message}</p></div></div> : this.props.children; }
}
