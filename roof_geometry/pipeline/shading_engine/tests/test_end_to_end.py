"""End-to-end tests for the shading engine processor.

These tests exercise the public ``run_shading_engine`` entry point and
check physical plausibility of the annual POA results.
"""

from __future__ import annotations

import pytest

from pipeline.shading_engine import run_shading_engine
from pipeline.shading_engine.schemas import SectionInput, ShadingRequest


def _boston_request(sections: list[SectionInput]) -> ShadingRequest:
    return ShadingRequest(
        lat=42.35,
        lng=-71.05,
        sections=sections,
    )


def test_boston_four_cardinal_sections_ordering_and_magnitude():
    """South >> E ~ W >> N for a 30 deg tilt at Boston lat.

    Also asserts each result falls within a physically-plausible
    clear-sky band.
    """
    request = _boston_request([
        SectionInput(id="north", azimuth_deg=0.0, pitch_deg=30.0),
        SectionInput(id="east", azimuth_deg=90.0, pitch_deg=30.0),
        SectionInput(id="south", azimuth_deg=180.0, pitch_deg=30.0),
        SectionInput(id="west", azimuth_deg=270.0, pitch_deg=30.0),
    ])

    response = run_shading_engine(request)

    by_id = {s.id: s.annual_kwh_per_m2 for s in response.sections}
    assert set(by_id.keys()) == {"north", "east", "south", "west"}

    # Ordering: south > east ~ west > north.
    assert by_id["south"] > by_id["east"]
    assert by_id["south"] > by_id["west"]
    assert by_id["east"] > by_id["north"]
    assert by_id["west"] > by_id["north"]

    # East and west should be within ~5% of each other (symmetric sun
    # path across the day, modulo tiny equation-of-time asymmetry).
    assert by_id["east"] == pytest.approx(by_id["west"], rel=0.05)

    # TMY-derated magnitudes (clearsky × 0.75). These bands reflect the
    # calibrated output after the TMY derate factor, matching Aurora's
    # actual scale for residential roofs in the US Northeast.
    assert 1300.0 <= by_id["south"] <= 1900.0, f"south out of band: {by_id['south']}"
    assert 550.0 <= by_id["north"] <= 1100.0, f"north out of band: {by_id['north']}"

    # Observed range mirrors the per-section min/max.
    assert response.observed_range.min_kwh_per_m2 == pytest.approx(by_id["north"], abs=0.01)
    assert response.observed_range.max_kwh_per_m2 == pytest.approx(by_id["south"], abs=0.01)


def test_flat_roof_is_azimuth_independent():
    """At pitch=0 the POA depends only on the horizon integral and
    should be identical regardless of surface azimuth."""
    request = _boston_request([
        SectionInput(id="flat_n", azimuth_deg=0.0, pitch_deg=0.0),
        SectionInput(id="flat_e", azimuth_deg=90.0, pitch_deg=0.0),
    ])
    response = run_shading_engine(request)

    a, b = response.sections[0].annual_kwh_per_m2, response.sections[1].annual_kwh_per_m2
    # Within 0.01% — they should actually be bit-identical, but allow
    # a tiny relative tolerance in case float ops re-order.
    assert a == pytest.approx(b, rel=1e-4)


def test_ten_sections_roundtrip_preserves_ids():
    """A 10-section request returns 10 results whose ids match the
    inputs 1:1 in order."""
    sections = [
        SectionInput(id=f"section_{i:02d}", azimuth_deg=(i * 36) % 360, pitch_deg=25.0)
        for i in range(10)
    ]
    response = run_shading_engine(_boston_request(sections))

    assert len(response.sections) == 10
    input_ids = [s.id for s in sections]
    output_ids = [s.id for s in response.sections]
    assert output_ids == input_ids

    # Every annual value should be positive and plausible (TMY-derated).
    for s in response.sections:
        assert 200.0 < s.annual_kwh_per_m2 < 1900.0
        assert s.annual_kwh == pytest.approx(s.annual_kwh_per_m2, rel=1e-6)  # default area=1.0


def test_area_scales_annual_kwh():
    """``annual_kwh = annual_kwh_per_m2 * area_m2`` — area is the only
    thing that distinguishes ``annual_kwh`` from the per-m² value."""
    sections = [
        SectionInput(id="unit", azimuth_deg=180.0, pitch_deg=30.0, area_m2=1.0),
        SectionInput(id="big", azimuth_deg=180.0, pitch_deg=30.0, area_m2=50.0),
    ]
    response = run_shading_engine(_boston_request(sections))

    unit = next(s for s in response.sections if s.id == "unit")
    big = next(s for s in response.sections if s.id == "big")

    # Same orientation → identical per-m² values (floor to avoid
    # rounding drift from the 2-dp quantization inside the processor).
    assert unit.annual_kwh_per_m2 == big.annual_kwh_per_m2
    # Area scales the total.
    assert big.annual_kwh == pytest.approx(50.0 * unit.annual_kwh_per_m2, rel=1e-4)
