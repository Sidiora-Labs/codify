from services.core import Engine as Runner
import os.path as paths

class Base:
    pass

@registry("service")
class Worker(Base):
    """Worker documentation."""

    @cached
    def run(self, value: int) -> str:
        """Run documentation."""
        def nested(item):
            return item
        engine: Runner = Runner()
        engine.execute(value)
        return nested(value)

message = "def phantom():\n    pass; phantom()"
# def commented(): pass

def later():
    return 3
