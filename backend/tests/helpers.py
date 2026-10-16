"""Small HTTP helpers shared by backend tests."""

import io


def register(client, email="user@example.com", password="correct-horse-9", display="Test"):
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "display_name": display},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def upload(client, token, filename="notes.pdf", content=b"%PDF-1.4 fake", **form):
    data = {k: v for k, v in form.items() if v is not None}
    return client.post(
        "/api/files/upload",
        headers=auth_headers(token),
        files={"file": (filename, io.BytesIO(content), "application/pdf")},
        data=data,
    )
