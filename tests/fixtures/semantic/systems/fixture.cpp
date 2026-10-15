#include <vector>
namespace demo {
class Base { public: virtual int run(int x) { return x; } };
class Worker : public Base {
public:
    int run(int x) override { return helper(x); }
    int helper(int x) { return x + 1; }
};
struct Abstract { virtual double area() const = 0; };
int execute() { Worker w; return w.run(2); }
}
