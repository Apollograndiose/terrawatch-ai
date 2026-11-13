import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BarList } from "./charts/BarList";
import { ErrorNote, ProvenanceTag, Segmented } from "./ui";
import { DEFAULT_FILTERS, FilterPanel } from "./dashboard/FilterPanel";

describe("ProvenanceTag", () => {
  it("distinguishes observed data from AI predictions", () => {
    render(
      <>
        <ProvenanceTag kind="observed" />
        <ProvenanceTag kind="ai" />
        <ProvenanceTag kind="derived" />
      </>,
    );
    expect(screen.getByText("Observed satellite data")).toBeInTheDocument();
    expect(screen.getByText("Experimental AI prediction")).toBeInTheDocument();
    expect(screen.getByText("Derived (algorithmic, not ML)")).toBeInTheDocument();
  });
});

describe("BarList", () => {
  it("renders an accessible list with values", () => {
    render(<BarList label="By source" rows={[{ key: "a", value: 1500 }, { key: "b", value: 10 }]} />);
    const list = screen.getByRole("list", { name: "By source" });
    expect(list.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("1.5K")).toBeInTheDocument();
  });
});

describe("ErrorNote", () => {
  it("announces errors and offers retry", () => {
    const retry = vi.fn();
    render(<ErrorNote message="API down" onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("API down");
    fireEvent.click(screen.getByText("Retry"));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe("Segmented", () => {
  it("exposes radio semantics", () => {
    const onChange = vi.fn();
    render(<Segmented label="Mode" value="a" onChange={onChange} options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} />);
    expect(screen.getByRole("radio", { name: "A" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "B" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("FilterPanel", () => {
  it("toggling a source narrows the source filter; toggling all back resets it", () => {
    const onChange = vi.fn();
    render(
      <FilterPanel filters={DEFAULT_FILTERS} onChange={onChange} info={undefined} feedRows={{}} imageryDate={null} onImageryDate={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /MODIS/ }));
    const next = onChange.mock.calls[0][0];
    expect(next.sources).toEqual(["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT"]);
  });

  it("switching dataset clears the date window", () => {
    const onChange = vi.fn();
    render(
      <FilterPanel
        filters={{ ...DEFAULT_FILTERS, start: "2026-11-05" }}
        onChange={onChange}
        info={undefined}
        feedRows={{}}
        imageryDate={null}
        onImageryDate={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Live NRT" }));
    expect(onChange.mock.calls[0][0]).toMatchObject({ dataset: "live", start: null, end: null });
  });
});
