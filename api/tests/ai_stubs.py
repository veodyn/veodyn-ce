"""A stand-in for the model.

Every AI test drives this rather than a real provider. That is not only about
cost: the behaviour worth testing is what happens to a model's answer AFTER it
arrives, and the interesting answers (an invented query id, a missing section, a
refused statement) are exactly the ones a real model will not produce on demand.
"""

from typing import Any


class FakeLlm:
    """Returns queued answers in order and records what it was asked."""

    def __init__(self, *answers: dict[str, Any]) -> None:
        self.answers = list(answers)
        self.prompts: list[str] = []
        self.systems: list[str] = []
        self.tools: list[str] = []

    @property
    def configured(self) -> bool:
        return True

    @property
    def calls(self) -> int:
        return len(self.prompts)

    def structured(
        self,
        *,
        system: str,
        prompt: str,
        schema: dict[str, Any],
        tool_name: str,
        temperature: float = 0.2,
    ) -> dict[str, Any]:
        self.systems.append(system)
        self.prompts.append(prompt)
        self.tools.append(tool_name)
        if not self.answers:
            raise AssertionError(f"the model was called more times than the test queued answers ({tool_name})")
        return self.answers.pop(0)


class FailingLlm:
    """A provider that is down. Used to check what still works without it."""

    def __init__(self, error: Exception) -> None:
        self.error = error
        self.calls = 0

    @property
    def configured(self) -> bool:
        return True

    def structured(self, **_: Any) -> dict[str, Any]:
        self.calls += 1
        raise self.error
