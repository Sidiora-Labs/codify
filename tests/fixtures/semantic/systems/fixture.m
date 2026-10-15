#import <Foundation/Foundation.h>
@interface Counter : NSObject
- (int)inc:(int)value;
@end
@implementation Counter
- (int)inc:(int)value { return value + 1; }
@end
int invoke(Counter *counter) { return [counter inc:2]; }
