from __future__ import annotations


def test_all_routes_require_admin():
    from app.routers.admin_users_monitor import router
    from app.auth_deps import require_admin
    assert router.routes, "router sem rotas"
    for route in router.routes:
        dep_calls = [d.call for d in route.dependant.dependencies]
        assert require_admin in dep_calls, f"{route.path} não exige require_admin"


def test_router_prefix():
    from app.routers.admin_users_monitor import router
    paths = {r.path for r in router.routes}
    assert "/api/admin/users-monitor" in paths
    assert "/api/admin/users-monitor/{owner_id}" in paths
    assert "/api/admin/users-monitor/refresh-live" in paths
