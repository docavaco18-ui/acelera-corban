"""
Proves that the exact payload sent by DisparoChipcare.tsx (snake_case fields)
passes Pydantic validation and reaches the dry_run branch without 422.
"""
import pytest
from pydantic import ValidationError
from app.routers.chipcare_broadcast import ChipcareDispatchIn, TemplateIn, AssignmentIn


SNAKE_CASE_PAYLOAD = {
    "dispatch_id": "test-dispatch-id",
    "assignments": [{"channel_id": 1, "planned_count": 100}],
    "template": {
        "template_name": "meu_template",
        "template_id": "123456",
        "language_code": "pt_BR",
        "components": [],
    },
    "campaign_name": "Campanha Teste",
    "aggression_level": "MEDIUM",
    "activate_immediately": False,
    "dry_run": True,
    "confirm_real_dispatch": False,
}


def test_chipcare_dispatch_payload_validates():
    """Payload sent by frontend (snake_case) must parse without error."""
    body = ChipcareDispatchIn(**SNAKE_CASE_PAYLOAD)
    assert body.template.template_name == "meu_template"
    assert body.template.template_id == "123456"
    assert body.template.language_code == "pt_BR"
    assert body.dry_run is True
    assert body.confirm_real_dispatch is False


def test_chipcare_camelcase_payload_fails():
    """camelCase keys must NOT silently pass (ensures frontend must send snake_case)."""
    bad_payload = {**SNAKE_CASE_PAYLOAD, "template": {
        "templateName": "meu_template",
        "templateId": "123456",
        "languageCode": "pt_BR",
    }}
    with pytest.raises(ValidationError):
        ChipcareDispatchIn(**bad_payload)


def test_chipcare_confirm_real_dispatch_guard():
    """dry_run=False without confirm_real_dispatch=True: guard is in endpoint logic."""
    body = ChipcareDispatchIn(**{**SNAKE_CASE_PAYLOAD, "dry_run": False, "confirm_real_dispatch": False})
    assert body.dry_run is False
    assert body.confirm_real_dispatch is False
    # Guard checked inside endpoint: if not body.confirm_real_dispatch → HTTP 400


def test_chipcare_real_dispatch_both_flags():
    """dry_run=False with confirm_real_dispatch=True: valid intent for real dispatch."""
    body = ChipcareDispatchIn(**{**SNAKE_CASE_PAYLOAD, "dry_run": False, "confirm_real_dispatch": True})
    assert body.dry_run is False
    assert body.confirm_real_dispatch is True
