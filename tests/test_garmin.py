"""Garmin integration is exercised without any external account or network."""

import importlib

import pytest

from runform import garmin
from runform.garmin_demo import SAMPLE_CHART_INSIGHTS
from runform.web import create_app


@pytest.fixture
def client():
    return create_app().test_client()


def test_demo_report_and_aligned_details(client, monkeypatch):
    monkeypatch.setattr(garmin, "_new_client", lambda *args: pytest.fail("Demo used Garmin"))
    monkeypatch.setattr(garmin, "_generate", lambda *args, **kw: pytest.fail("Demo used Gemini"))
    payload = client.get("/api/garmin/demo").json
    assert payload["demo"] is True
    assert payload["report"]["runs_total"] == len(payload["activities"]) == 32
    assert payload["report"]["distance_miles"] == pytest.approx(
        sum(run["distance"] for run in payload["activities"]),
        abs=0.01,
    )
    run = payload["activities"][0]
    details = client.get(f"/api/garmin/demo/activity/{run['id']}/details").json
    series = [
        "elapsed",
        "pace",
        "hr",
        "cadence",
        "vertOsc",
        "vertRatio",
        "gct",
        "strideLength",
        "elevation",
    ]
    assert {len(details[key]) for key in series} == {121}
    assert len(details["route"]) == 121
    assert details["elapsed"][0] == 0
    assert 160 <= details["cadence"][0] <= 185
    assert details["strideLength"][0] == pytest.approx(run["strideLength"], abs=0.001)
    assert client.get("/api/garmin/demo/activity/1/details").status_code == 404
    for kind in ("run", "trends"):
        response = client.post(f"/api/garmin/analyze/{kind}", json={"demo": True})
        assert response.status_code == 200
        assert "Sample coaching" in response.json["analysis"]
        assert response.json["demo"] is True
    charts = client.post("/api/garmin/analyze/charts", json={"demo": True})
    assert SAMPLE_CHART_INSIGHTS.keys() <= charts.json.keys()


def test_normalization_units_missing_values_and_rounding():
    raw = {
        "distance": 1609.344,
        "duration": 3599.8,
        "averageSpeed": 1609.344 / 479.7,
        "avgStrideLength": 108,
        "elevationGain": 100,
        "aerobicTrainingEffect": 0,
        "activityName": "My run",
        "averageRunningCadenceInStepsPerMinute": 171,
    }
    run = garmin.normalize_activity(raw)
    assert run["distance"] == 1
    assert run["time"] == "01:00:00"
    assert run["avgPace"] == "8:00"
    assert run["strideLength"] == 1.08
    assert run["ascent"] == 328
    assert run["aerobicTE"] == 0
    assert run["cadence"] == 171
    assert run["gct"] is None
    assert garmin._speed_to_pace(0) is None
    assert garmin._secs_to_timestr(None) is None
    assert garmin.normalize_activity({"averageHR": float("nan")})["avgHR"] is None
    assert garmin.activity_report([])["avg_pace"] is None


def test_detail_descriptor_order_full_cadence_and_units():
    data = {
        "metricDescriptors": [
            {"key": "directRunCadence", "metricsIndex": 0},
            {"key": "directDoubleCadence", "metricsIndex": 1},
            {"key": "directStrideLength", "metricsIndex": 2},
            {"key": "directElevation", "metricsIndex": 3},
            {"key": "directVerticalOscillation", "metricsIndex": 4},
            {"key": "directTimestamp", "metricsIndex": 5},
        ],
        "activityDetailMetrics": [
            {"metrics": [85, 171, 73.3, 50.2, 9.17, 1000]},
            {"metrics": [86, None, 74, None, 9, 61000]},
        ],
    }
    result = garmin.normalize_details(data)
    assert result["cadence"] == [171, None]
    assert result["strideLength"][0] == 0.733
    assert result["elevation"][0] == pytest.approx(164.698, abs=0.001)
    assert result["vertOsc"][0] == 9.17
    assert result["elapsed"] == [0, 1]
    assert result["hr"] == [None, None]
    assert result["route"] == []
    data["metricDescriptors"] = [
        {"key": "directRunCadence", "metricsIndex": 0},
        {"key": "directFractionalCadence", "metricsIndex": 1},
    ]
    data["activityDetailMetrics"] = [{"metrics": [85, 0.5]}, {"metrics": []}]
    assert garmin.normalize_details(data)["cadence"] == [171, None]


class FakeGarmin:
    def __init__(self, email, password, mfa=False):
        self.email = email
        self.password = password
        self.mfa = mfa
        self.resumed = False
        self.pages = []

    def login(self):
        return ("needs_mfa", {"nonce": "fake"}) if self.mfa else (None, None)

    def resume_login(self, state, code):
        assert state == {"nonce": "fake"}
        assert code == "123456"
        self.resumed = True

    def get_activities(self, start, limit):
        self.pages.append((start, limit))
        if start == 0:
            return [
                {
                    "activityId": i,
                    "activityType": {"typeKey": "running"},
                    "distance": 1609.344,
                    "duration": 500,
                }
                for i in range(99)
            ] + [{"activityId": 200, "activityType": {"typeKey": "cycling"}}]
        return [{"activityId": 100, "activityType": {"typeKey": "trail_running"}}]

    def get_activity_details(self, activity_id, maxchart):
        assert activity_id == "100"
        assert maxchart == 500
        return {"metricDescriptors": [], "activityDetailMetrics": [{"metrics": []}]}


def test_login_pagination_session_isolation_logout():
    app = create_app()
    instances = []

    def factory(email, password):
        instance = FakeGarmin(email, password)
        instances.append(instance)
        return instance

    app.config["GARMIN_CLIENT_FACTORY"] = factory
    first, second = app.test_client(), app.test_client()
    response = first.post(
        "/api/garmin/login", json={"email": "user@example.test", "password": "secret"}
    )
    assert response.json == {"status": "ok"}
    cookie = response.headers["Set-Cookie"]
    assert "HttpOnly" in cookie and "SameSite=Strict" in cookie
    assert "secret" not in cookie and "user@example.test" not in cookie
    assert instances[0].password is None
    assert first.get("/api/garmin/status").json["connected"] is True
    assert second.get("/api/garmin/status").json["connected"] is False
    assert second.get("/api/garmin/activities").status_code == 401
    payload = first.get("/api/garmin/activities").json
    assert len(payload["activities"]) == 100
    assert instances[0].pages == [(0, 100), (100, 100)]
    assert payload["report"]["distance_miles"] == 99
    details = first.get("/api/garmin/activity/100/details").json
    assert details["hr"] == [None]
    assert first.post("/api/garmin/logout").json == {"status": "ok"}
    assert first.get("/api/garmin/activities").status_code == 401


def test_mfa_is_per_browser_and_clears_password():
    app = create_app()
    instance = FakeGarmin("user", "secret", mfa=True)
    app.config["GARMIN_CLIENT_FACTORY"] = lambda *args: instance
    first, second = app.test_client(), app.test_client()
    assert first.post("/api/garmin/login", json={"email": "user", "password": "secret"}).json == {
        "status": "mfa_required",
    }
    assert first.get("/api/garmin/activities").status_code == 401
    assert second.post("/api/garmin/mfa", json={"code": "123456"}).status_code == 400
    assert first.post("/api/garmin/mfa", json={"code": "123456"}).json == {"status": "ok"}
    assert instance.resumed
    assert instance.password is None
    assert first.get("/api/garmin/status").json["connected"] is True


@pytest.mark.parametrize(
    "path", ["login", "mfa", "analyze/run", "analyze/charts", "analyze/trends"]
)
@pytest.mark.parametrize("payload", [None, [], "text"])
def test_malformed_json_returns_validation_error(client, path, payload):
    response = client.post(f"/api/garmin/{path}", json=payload)
    assert response.status_code == 400


def test_missing_credentials_and_unauthenticated_requests(client):
    assert client.post("/api/garmin/login", json={}).status_code == 400
    assert client.post("/api/garmin/mfa", json={"code": ""}).status_code == 400
    assert client.get("/api/garmin/activities").status_code == 401
    assert client.get("/api/garmin/activity/1/details").status_code == 401
    assert client.post("/api/garmin/analyze/run", json={"distance": 1}).status_code == 401
    assert client.post("/api/garmin/analyze/unknown", json={}).status_code == 404


def test_missing_optional_dependencies_and_disk_token_setting(client, monkeypatch):
    monkeypatch.delenv("GARMINTOKENS", raising=False)
    original = importlib.import_module

    def missing(name):
        if name == "garminconnect":
            raise ImportError("Not installed")
        return original(name)

    monkeypatch.setattr(garmin.importlib, "import_module", missing)
    data = {"email": "user", "password": "secret"}
    response = client.post("/api/garmin/login", json=data)
    assert response.status_code == 503
    assert "pip install" in response.json["message"]
    monkeypatch.setenv("GARMINTOKENS", "/private/tokens")
    response = client.post("/api/garmin/login", json=data)
    assert response.status_code == 503
    assert "Unset GARMINTOKENS" in response.json["message"]
    assert client.get("/").status_code == client.get("/api/garmin/demo").status_code == 200


def test_login_errors_do_not_echo_credentials(client):
    def failing(*args):
        raise ValueError("secret password user@example.test")

    client.application.config["GARMIN_CLIENT_FACTORY"] = failing
    response = client.post("/api/garmin/login", json={"email": "user", "password": "secret"})
    assert response.status_code == 401
    assert "secret" not in response.json["message"]


def test_optional_coaching_is_explicit_and_excludes_gps(client, monkeypatch):
    client.application.config["GARMIN_CLIENT_FACTORY"] = lambda *args: FakeGarmin("user", "secret")
    client.post("/api/garmin/login", json={"email": "user", "password": "secret"})
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    original = importlib.import_module

    def without_dotenv(name):
        if name == "dotenv":
            raise ImportError("Not installed")
        return original(name)

    monkeypatch.setattr(garmin.importlib, "import_module", without_dotenv)
    response = client.post("/api/garmin/analyze/run", json={"distance": 3})
    assert response.status_code == 503
    assert "GEMINI_API_KEY" in response.json["error"]
    seen = []

    def generate(prompt, as_json=False):
        seen.append(prompt)
        return "Sample provider response"

    monkeypatch.setattr(garmin, "_generate", generate)
    response = client.post(
        "/api/garmin/analyze/run",
        json={
            "distance": 3,
            "route": [[40, -70]],
            "password": "do-not-send",
            "title": "private name",
        },
    )
    assert response.json["analysis"] == "Sample provider response"
    assert "do-not-send" not in seen[0] and "private name" not in seen[0]
    assert '"route"' not in seen[0]
    assert client.post("/api/garmin/analyze/trends", json={"runs": [1]}).status_code == 400


def test_cross_origin_credentials_are_rejected(client):
    response = client.post(
        "/api/garmin/login",
        json={"email": "user", "password": "secret"},
        headers={"Origin": "https://example.test"},
    )
    assert response.status_code == 403
