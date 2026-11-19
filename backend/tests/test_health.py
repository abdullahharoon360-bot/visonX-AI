def test_health_live_returns_ok(client):
    response = client.get("/api/v1/health/live")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "timestamp" in body
    assert "X-Request-ID" in response.headers


def test_health_ready_reports_degraded_without_env(client):
    response = client.get("/api/v1/health/ready")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["checks"]["database_connected"] is False
