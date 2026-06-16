import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClipboardList, Inbox, User } from "lucide-react";

import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageMenuTiles, type PageMenuTileItem } from "./PageMenuTiles";

/**
 * Slice 11D — the shared page-level tile menu standard. These prove a tile
 * renders icon-above-label, drives its `<TabsContent>` (selected state +
 * switching), and keeps status indicators (missing dot, attention dot, count /
 * zero-count badge) and a stable, fixed-size layout for long labels.
 */

function renderTiles(items: PageMenuTileItem[], defaultValue: string) {
  return render(
    <Tabs defaultValue={defaultValue}>
      <PageMenuTiles items={items} ariaLabel="Test menu" />
      {items.map((i) => (
        <TabsContent key={i.value} value={i.value}>
          Content for {i.value}
        </TabsContent>
      ))}
    </Tabs>,
  );
}

const BASE: PageMenuTileItem[] = [
  { value: "contact", label: "Contact", icon: User },
  { value: "work", label: "Work-order", icon: ClipboardList },
  { value: "requests", label: "My Request", icon: Inbox },
];

describe("PageMenuTiles", () => {
  it("renders one icon-above-label tile per item, exposed as a tab", () => {
    renderTiles(BASE, "contact");
    const list = screen.getByTestId("page-menu-tiles");
    for (const label of ["Contact", "Work-order", "My Request"]) {
      expect(within(list).getByRole("tab", { name: label })).toBeInTheDocument();
    }
    // Icon + label both present inside a tile.
    const tile = screen.getByTestId("page-menu-tile-contact");
    expect(within(tile).getByTestId("page-menu-tile-icon-contact")).toBeInTheDocument();
    expect(tile).toHaveTextContent("Contact");
  });

  it("marks the default tile active and switches content on selection", () => {
    renderTiles(BASE, "contact");
    expect(screen.getByRole("tab", { name: "Contact" })).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Content for contact")).toBeInTheDocument();

    // Radix Tabs activate on mousedown (matches the Calculator tab tests).
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Work-order" }));
    expect(screen.getByRole("tab", { name: "Work-order" })).toHaveAttribute("data-state", "active");
    expect(screen.getByText("Content for work")).toBeInTheDocument();
  });

  it("uses a consistent icon size for every tile", () => {
    renderTiles(BASE, "contact");
    for (const value of ["contact", "work", "requests"]) {
      expect(screen.getByTestId(`page-menu-tile-icon-${value}`)).toHaveClass("h-5", "w-5");
    }
  });

  it("renders a count badge only when count > 0", () => {
    renderTiles(
      [
        { value: "a", label: "A", icon: User, count: 3 },
        { value: "b", label: "B", icon: User, count: 0 },
      ],
      "a",
    );
    expect(screen.getByTestId("page-menu-tile-count-a")).toHaveTextContent("3");
    expect(screen.queryByTestId("page-menu-tile-count-b")).not.toBeInTheDocument();
  });

  it("renders a neutral zero badge when showZeroCount is set", () => {
    renderTiles([{ value: "a", label: "A", icon: Inbox, count: 0, showZeroCount: true }], "a");
    expect(screen.getByTestId("page-menu-tile-count-a")).toHaveTextContent("0");
  });

  it("renders the red missing-setup dot and the amber attention dot", () => {
    renderTiles(
      [
        { value: "a", label: "A", icon: User, isMissing: true },
        { value: "b", label: "B", icon: User, needsAttention: true },
      ],
      "a",
    );
    expect(screen.getByTestId("page-menu-tile-missing-a")).toBeInTheDocument();
    expect(screen.getByTestId("page-menu-tile-attention-b")).toBeInTheDocument();
  });

  it("disables a tile when disabled is set", () => {
    renderTiles([{ value: "a", label: "A", icon: User, disabled: true }], "a");
    expect(screen.getByRole("tab", { name: "A" })).toBeDisabled();
  });

  it("keeps a fixed tile size and exposes the full label via title for long labels", () => {
    const longLabel = "A very long custom menu label that must stay stable";
    renderTiles([{ value: "a", label: longLabel, icon: User }], "a");
    const tile = screen.getByTestId("page-menu-tile-a");
    // Fixed width (flex-wrap on the list) is what prevents long-label distortion.
    expect(tile).toHaveClass("w-[88px]", "h-20");
    expect(tile).toHaveAttribute("title", longLabel);
    expect(screen.getByTestId("page-menu-tile-icon-a")).toHaveClass("h-5", "w-5");
  });
});
