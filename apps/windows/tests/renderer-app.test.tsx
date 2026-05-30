import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/renderer/src/App";

describe("Windows renderer app", () => {
  it("renders the accounts workspace and navigates to proxy and settings", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Accounts" })).toBeTruthy();
    expect(screen.getByText("Add ChatGPT OAuth or import an existing Codex auth file.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Proxy" }));
    expect(screen.getByRole("heading", { name: "Proxy" })).toBeTruthy();
    expect(screen.getByText("/v1/chat/completions")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByText("Launch at startup")).toBeTruthy();
  });
});
