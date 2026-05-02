import pytest
from unittest.mock import MagicMock
from app.db_scoped import scoped, TENANT_TABLES


@pytest.fixture
def fake_db():
    db = MagicMock()
    db.table.return_value = MagicMock()
    return db


def test_scoped_rejects_non_tenant_table(fake_db):
    with pytest.raises(ValueError, match="não é tabela tenant"):
        scoped(fake_db, "user_bank_credentials", "u1")


def test_scoped_select_forces_owner_filter(fake_db):
    q = fake_db.table.return_value
    q.select.return_value.eq.return_value = q
    scoped(fake_db, "v8_leads", "u1").select("*").execute()
    q.select.assert_called_with("*")
    q.select.return_value.eq.assert_called_with("owner_id", "u1")


def test_scoped_insert_injects_owner_id_dict(fake_db):
    q = fake_db.table.return_value
    q.insert.return_value = q
    scoped(fake_db, "v8_leads", "u1").insert({"cpf": "123"}).execute()
    q.insert.assert_called_with({"cpf": "123", "owner_id": "u1"})


def test_scoped_insert_injects_owner_id_list(fake_db):
    q = fake_db.table.return_value
    q.insert.return_value = q
    scoped(fake_db, "v8_leads", "u1").insert([{"cpf": "1"}, {"cpf": "2"}]).execute()
    q.insert.assert_called_with([{"cpf": "1", "owner_id": "u1"}, {"cpf": "2", "owner_id": "u1"}])


def test_scoped_update_forces_owner_filter(fake_db):
    q = fake_db.table.return_value
    q.update.return_value.eq.return_value = q
    scoped(fake_db, "v8_leads", "u1").update({"status": "ok"}).eq("cpf", "123").execute()
    q.update.assert_called_with({"status": "ok"})
    q.update.return_value.eq.assert_called_with("owner_id", "u1")


def test_scoped_upsert_injects_owner_id(fake_db):
    q = fake_db.table.return_value
    q.upsert.return_value = q
    scoped(fake_db, "v8_leads", "u1").upsert({"cpf": "123"}, on_conflict="cpf,owner_id").execute()
    q.upsert.assert_called_with({"cpf": "123", "owner_id": "u1"}, on_conflict="cpf,owner_id")


def test_scoped_delete_forces_owner_filter(fake_db):
    q = fake_db.table.return_value
    q.delete.return_value.eq.return_value = q
    scoped(fake_db, "v8_leads", "u1").delete().eq("cpf", "123").execute()
    q.delete.return_value.eq.assert_called_with("owner_id", "u1")


def test_scoped_supports_postgrest_filters(fake_db):
    q = fake_db.table.return_value
    q.select.return_value.eq.return_value = q
    for m in ("neq", "gt", "gte", "lt", "lte", "is_", "like", "ilike", "order", "limit", "range", "single", "maybe_single"):
        getattr(q, m).return_value = q
    sq = scoped(fake_db, "v8_leads", "u1").select("*")
    sq.neq("status", "x").gt("v", 0).gte("v", 0).lt("v", 9).lte("v", 9) \
      .is_("c", None).like("n", "a%").ilike("n", "a%") \
      .order("created_at").limit(10).range(0, 9).single().execute()


def test_tenant_tables_constant():
    assert TENANT_TABLES == {"v8_leads", "v8_bot_runs", "v8_batches"}
