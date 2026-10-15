require 'services/core'
module Services
  class Worker < Base
    # Run documentation.
    def run(value)
      def nested(item)
        item
      end
      engine = Engine.new
      engine.execute(value)
      nested(value)
    end
  end
end
message = "def phantom; end"
# def commented; end
def later
  3
end
