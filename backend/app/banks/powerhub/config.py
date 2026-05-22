from dataclasses import dataclass


@dataclass
class PowerHubConfig:
    jitter_min: float = 1.0
    jitter_max: float = 3.0
    max_retries: int = 2
