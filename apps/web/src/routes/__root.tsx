import { HeadContent, Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import "../index.css";

export interface RouterAppContext {}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      {
        title: "Scanme — Find every barcode in a screenshot",
      },
      {
        name: "description",
        content:
          "Paste or upload a screenshot and detect every readable 1D and 2D barcode privately in your browser.",
      },
      {
        name: "theme-color",
        content: "#17352b",
      },
    ],
    links: [
      {
        rel: "icon",
        href: "/icon.svg",
      },
    ],
  }),
});

function RootComponent() {
  return (
    <>
      <HeadContent />
      <Outlet />
    </>
  );
}
