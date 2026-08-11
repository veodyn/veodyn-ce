from fastapi.testclient import TestClient


def test_health_reports_ok_without_auth(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
