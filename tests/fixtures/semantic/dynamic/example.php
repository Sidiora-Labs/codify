<?php
namespace Services;
use Vendor\Runtime\Engine as Runner;
use Vendor\Tool\{Alpha, Beta as Named};

#[Service]
class Worker extends Base implements Runnable {
    /** Run documentation. */
    #[Route('/run')]
    public function run(int $value): string {
        function nested($item) { return $item; }
        $engine = new Runner();
        $engine->execute($value);
        return nested($value);
    }
}
$message = 'function phantom() {}';
// function commented() {}
function later(): int { return 3; }
