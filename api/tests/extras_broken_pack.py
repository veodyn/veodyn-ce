"""A pack that imports and then fails, for the extras test.

Not named test_*, so pytest does not collect it. It exists to prove that a
failure inside a named module reaches the caller rather than being logged and
stepped over, which would leave the pack half registered.
"""

RAISES = 1 / 0
