"""
Confidence scoring: per-element and overall confidence,
with disagreement tracking between LiDAR and image data.
"""

from __future__ import annotations

import logging
from typing import Any

from models.schemas import (
    ConfidenceReport,
    Disagreement,
    RoofGraph,
)
from pipeline.image_detector import ImageDetections

logger = logging.getLogger(__name__)


def score_confidence(
    roof_graph: RoofGraph,
    fusion_metadata: dict[str, Any] | None = None,
    *,
    review_threshold: float = 0.6,
) -> ConfidenceReport:
    """
    Compute per-element and overall confidence scores for a RoofGraph.

    Parameters
    ----------
    roof_graph : RoofGraph
        The complete detected roof topology.
    fusion_metadata : dict, optional
        Additional metadata from the fusion step (e.g., IoU scores,
        disagreement details).
    review_threshold : float
        Elements scoring below this are flagged for manual review.

    Returns
    -------
    ConfidenceReport
        Confidence summary with review flags and disagreements.
    """
    if fusion_metadata is None:
        fusion_metadata = {}

    planes_needing_review: list[str] = []
    edges_needing_review: list[str] = []
    dormers_needing_review: list[str] = []
    obstructions_needing_review: list[str] = []
    disagreements: list[Disagreement] = []

    # --- Per-plane confidence ---
    plane_scores: list[float] = []
    for plane in roof_graph.planes:
        score = plane.confidence

        # Boost if plane has many neighbours (well-connected)
        n_neighbors = len(roof_graph.adjacency.get(plane.id, []))
        connectivity_bonus = min(0.1, n_neighbors * 0.03)
        score = min(1.0, score + connectivity_bonus)

        # Penalise very small area (less reliable)
        if plane.area_m2 < 3.0:
            score *= 0.85

        # Penalise near-flat planes (may be noise)
        if plane.is_flat and plane.area_m2 < 10.0:
            score *= 0.9

        plane_scores.append(score)
        if score < review_threshold:
            planes_needing_review.append(plane.id)

    # --- Per-edge confidence ---
    edge_scores: list[float] = []
    for edge in roof_graph.edges:
        score = edge.confidence

        # Longer edges are more reliable
        if edge.length_m > 3.0:
            score = min(1.0, score + 0.05)
        elif edge.length_m < 0.5:
            score *= 0.8

        edge_scores.append(score)
        if score < review_threshold:
            edges_needing_review.append(edge.id)

    # --- Dormer confidence ---
    for dormer in roof_graph.dormers:
        score = dormer.confidence

        # Penalise very small dormers
        if dormer.width_m < 0.5 or dormer.depth_m < 0.5:
            score *= 0.7

        # Penalise irregular aspect ratios
        aspect = max(dormer.width_m, dormer.depth_m) / max(min(dormer.width_m, dormer.depth_m), 0.01)
        if aspect > 5:
            score *= 0.8

        if score < review_threshold:
            dormers_needing_review.append(dormer.id)

    # --- Obstruction confidence ---
    for obs in roof_graph.obstructions:
        if obs.confidence < review_threshold:
            obstructions_needing_review.append(obs.id)

    # --- Disagreements from fusion metadata ---
    raw_disagreements = fusion_metadata.get("disagreements", [])
    for d in raw_disagreements:
        disagreements.append(Disagreement(
            element_id=d.get("element_id", "unknown"),
            lidar_value=d.get("lidar_value"),
            image_value=d.get("image_value"),
            chosen_value=d.get("chosen_value"),
            reason=d.get("reason", ""),
        ))

    # --- Overall confidence ---
    all_scores = plane_scores + edge_scores
    if all_scores:
        # Weighted: planes count more than edges
        plane_weight = 2.0
        edge_weight = 1.0
        total_weight = plane_weight * len(plane_scores) + edge_weight * len(edge_scores)
        weighted_sum = (
            plane_weight * sum(plane_scores) +
            edge_weight * sum(edge_scores)
        )
        overall = weighted_sum / total_weight if total_weight > 0 else 0.5
    else:
        overall = 0.0

    # Penalise if many elements need review
    total_elements = len(roof_graph.planes) + len(roof_graph.edges)
    review_count = len(planes_needing_review) + len(edges_needing_review)
    if total_elements > 0:
        review_fraction = review_count / total_elements
        overall *= (1.0 - 0.3 * review_fraction)

    overall = round(max(0.0, min(1.0, overall)), 3)

    report = ConfidenceReport(
        overall_confidence=overall,
        planes_needing_review=planes_needing_review,
        edges_needing_review=edges_needing_review,
        dormers_needing_review=dormers_needing_review,
        obstructions_needing_review=obstructions_needing_review,
        disagreements=disagreements,
    )

    logger.info(
        "Confidence report: overall=%.3f, review: %d planes, %d edges, %d dormers, %d obstructions",
        overall,
        len(planes_needing_review),
        len(edges_needing_review),
        len(dormers_needing_review),
        len(obstructions_needing_review),
    )

    return report
