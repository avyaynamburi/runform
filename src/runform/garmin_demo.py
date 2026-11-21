"""Synthetic training data for the public, credential-free Garmin showcase."""

import math
from datetime import date, datetime, time, timedelta


def raw_demo_activities(today: date | None = None) -> list[dict]:
    """Eight weeks of invented runs, never copied from a Garmin account."""
    today = today or date.today()
    runs = []
    names = ["Easy miles", "Steady run", "Intervals", "Long run"]
    for index in range(32):
        day = today - timedelta(days=(31 - index) * 2)
        distance_miles = [3.4, 4.7, 4.2, 7.8][index % 4] + index * 0.025
        pace_seconds = [570, 535, 490, 560][index % 4] - index * 0.8
        duration = round(distance_miles * pace_seconds)
        speed = 1609.344 / pace_seconds
        runs.append(
            {
                "activityId": 1000 + index,
                "activityName": names[index % 4],
                "activityType": {"typeKey": "running"},
                "startTimeLocal": datetime.combine(day, time(7, 15)).isoformat(),
                "distance": distance_miles * 1609.344,
                "duration": duration,
                "averageSpeed": speed,
                "maxSpeed": speed * 1.18,
                "averageHR": 140 + index % 4 * 5,
                "maxHR": 161 + index % 4 * 4,
                "averageRunningCadenceInStepsPerMinute": round(166 + index * 0.35, 1),
                "maxRunCadence": 188 + index % 5,
                "avgStrideLength": round(speed / ((166 + index * 0.35) / 60) * 100, 1),
                "avgGroundContactTime": round(263 - index * 0.6, 1),
                "avgVerticalOscillation": round(8.8 - index * 0.025, 2),
                "avgVerticalRatio": round(9.1 - index * 0.045, 2),
                "elevationGain": 25 + index % 7 * 7,
                "elevationLoss": 24 + index % 7 * 7,
                "calories": round(distance_miles * 103),
                "aerobicTrainingEffect": round(2.5 + index % 4 * 0.35, 1),
                "anaerobicTrainingEffect": round(0.2 + index % 4 * 0.6, 1),
                "trainingStressScore": 35 + index % 4 * 14,
            }
        )
    return list(reversed(runs))


def raw_demo_details(activity_id: int) -> dict | None:
    run = next((r for r in raw_demo_activities() if r["activityId"] == activity_id), None)
    if run is None:
        return None
    keys = [
        "directTimestamp",
        "directHeartRate",
        "directDoubleCadence",
        "directVerticalOscillation",
        "directVerticalRatio",
        "directGroundContactTime",
        "directStrideLength",
        "directSpeed",
        "directElevation",
        "directLatitude",
        "directLongitude",
    ]
    points = []
    for i in range(121):
        phase = i / 120 * math.tau
        wave = math.sin(phase * 4)
        points.append(
            {
                "metrics": [
                    i / 120 * run["duration"] * 1000,
                    round(run["averageHR"] + 5 * wave + i / 40, 1),
                    round(run["averageRunningCadenceInStepsPerMinute"] + 2 * wave, 1),
                    round(run["avgVerticalOscillation"] + 0.3 * wave, 2),
                    round(run["avgVerticalRatio"] + 0.25 * wave, 2),
                    round(run["avgGroundContactTime"] + 7 * wave, 1),
                    round(run["avgStrideLength"] + 3 * wave, 2),
                    run["averageSpeed"] * (1 + 0.035 * wave),
                    28 + 4 * math.sin(phase * 2),
                    40.7825 + 0.008 * math.sin(phase),
                    -73.966 + 0.004 * math.cos(phase),
                ]
            }
        )
    return {
        "metricDescriptors": [{"key": key, "metricsIndex": i} for i, key in enumerate(keys)],
        "activityDetailMetrics": points,
    }


SAMPLE_COACHING = (
    "Sample coaching · prewritten for this synthetic training history.\n\n"
    "The example schedule alternates easy, steady, interval, and longer runs. "
    "Weekly mileage and pace charts help show how volume and effort change together.\n\n"
    "In this invented history, cadence gradually rises while ground contact time and "
    "vertical ratio decline. Compare similar efforts before interpreting a trend: "
    "terrain, fatigue, and speed can all change these measurements.\n\n"
    "Use the run detail to compare the pace and heart-rate traces, then review how "
    "cadence changes during the same portions of the run."
)

SAMPLE_CHART_INSIGHTS = {
    "pace": "Sample insight: the repeating pace changes are invented steady-effort variations. "
    "Lower min/mile values indicate faster running.",
    "hr": "Sample insight: heart rate measures effort. This synthetic trace rises gently "
    "through the run and varies with the example pace.",
    "cadence": "Sample insight: cadence counts steps per minute. Compare it at similar speeds, "
    "rather than treating a single cadence as a universal goal.",
    "vertOsc": "Sample insight: vertical oscillation measures up-and-down movement in centimeters. "
    "This device-style value differs from video analysis's relative body height.",
    "vertRatio": "Sample insight: vertical ratio relates vertical movement to stride length. "
    "These invented values show small changes through the stride sequence.",
    "gct": "Sample insight: ground contact time is measured in milliseconds per step. "
    "Speed, slope, and sensor placement affect comparisons.",
    "strideLength": "Sample insight: stride length is displayed in meters. Longer strides alone "
    "do not establish better running technique.",
    "elevation": "Sample insight: elevation is displayed in feet. The sample loop and elevation "
    "profile are synthetic and do not represent a recorded workout.",
}
