import { defineMain } from "fluxdown-plugin-sdk/runtime";
import type { ViewEvent } from "fluxdown-plugin-sdk";

interface State {
  count: number;
}

defineMain((flux) => {
  flux.ui.view<State>("dashboard", {
    init: () => ({ count: 0 }),
    render: (state) => (
      <stack gap="md" padding="md">
        <heading text="Hello from FluxDown" />
        <text text={`Clicked ${state.count} times`} />
        <button key="inc" text="Click me" variant="primary" />
      </stack>
    ),
    event(state, ev: ViewEvent) {
      if (ev.type === "press" && ev.node === "root/inc") state.count += 1;
    },
  });

  flux.commands.register("hello", () => {
    flux.ui.toast("success", "Hello from Bilibili Downloader!");
  });
});
